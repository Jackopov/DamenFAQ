#!/usr/bin/env perl
# Minimal file server for the DamenFAQ preview.
# Serves static files from <root-dir> and supports anonymous question stats:
#   GET  /stats.json  -> aggregated stats, bucketed per day
#                       { "daily": { "YYYY-MM-DD": { questions: {id: n}, unanswered: {text: n}, total: n } }, "updated": iso }
#   POST /stats.json  -> body {"id": 3}   (a FAQ question was answered)
#                     -> body {"text": "..."} (a query had no match)
# Events are appended to the bucket of the current day, so nothing is ever
# erased — the history accumulates and the admin panel groups it by day/week/month.
# Usage: perl serve-faq.pl <root-dir> <port>
use strict;
use warnings;
use IO::Socket::INET;
use JSON::PP;
use POSIX qw(strftime);

my ($root, $port) = @ARGV;
$root ||= '.';
$port ||= 8000;
$root =~ s{[\\/]+$}{};
my $root_full = $root;
my $stats_file = "$root_full/stats.json";

my $sock = IO::Socket::INET->new(
    LocalAddr => '127.0.0.1',
    LocalPort => $port,
    Proto     => 'tcp',
    ReuseAddr => 1,
    Listen    => 64,
) or die "cannot bind 127.0.0.1:$port: $!\n";

print "LISTENING 127.0.0.1:$port root=$root_full\n";
$| = 1;

sub mime {
    my ($path) = @_;
    return 'text/html; charset=utf-8'  if $path =~ /\.html?$/i;
    return 'text/css; charset=utf-8'   if $path =~ /\.css$/i;
    return 'application/javascript; charset=utf-8' if $path =~ /\.js$/i;
    return 'application/json; charset=utf-8' if $path =~ /\.json$/i;
    return 'image/png'                 if $path =~ /\.png$/i;
    return 'image/svg+xml'             if $path =~ /\.svg$/i;
    return 'image/x-icon'              if $path =~ /\.ico$/i;
    return 'application/octet-stream';
}

sub urldecode {
    my ($s) = @_;
    $s =~ s/\+/ /g;
    $s =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/eg;
    return $s;
}

sub http_error {
    my ($client, $code, $msg) = @_;
    my $reason = $msg // 'Error';
    print $client "HTTP/1.0 $code $reason\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
}

sub stats_read {
    my $stats = { daily => {}, updated => undef };
    if (-f $stats_file) {
        open my $fh, '<:raw', $stats_file or return $stats;
        local $/;
        my $txt = <$fh>;
        close $fh;
        my $d = eval { JSON::PP->new->utf8->decode($txt) };
        if ($d && ref $d eq 'HASH') { $stats = $d; }
    }
    # Migrate the old flat format ({questions, unanswered, total}) to daily buckets.
    if ((!$stats->{daily} || ref $stats->{daily} ne 'HASH') && ref $stats->{questions} eq 'HASH') {
        my $day = $stats->{updated} ? substr($stats->{updated}, 0, 10) : strftime("%Y-%m-%d", localtime);
        $stats->{daily} = {
            $day => {
                questions  => $stats->{questions},
                unanswered => (ref $stats->{unanswered} eq 'HASH' ? $stats->{unanswered} : {}),
                total      => ($stats->{total} =~ /^\d+$/ ? $stats->{total} : 0)
            }
        };
        delete $stats->{questions};
        delete $stats->{unanswered};
        delete $stats->{total};
    }
    $stats->{daily} = {} unless $stats->{daily} && ref $stats->{daily} eq 'HASH';
    return $stats;
}

sub stats_write {
    my ($stats) = @_;
    my $tmp = "$stats_file.tmp";
    if (open my $fh, '>:raw', $tmp) {
        print $fh JSON::PP->new->utf8->canonical->pretty->encode($stats);
        close $fh;
        rename $tmp, $stats_file;
        return 1;
    }
    return 0;
}

# Bucket for the current day; creates it on demand.
sub stats_day {
    my ($stats) = @_;
    my $key = strftime("%Y-%m-%d", localtime);
    my $day = $stats->{daily}{$key};
    unless ($day && ref $day eq 'HASH') {
        $day = { questions => {}, unanswered => {}, total => 0 };
        $stats->{daily}{$key} = $day;
    }
    $day->{questions}  = {} unless $day->{questions}  && ref $day->{questions}  eq 'HASH';
    $day->{unanswered} = {} unless $day->{unanswered} && ref $day->{unanswered} eq 'HASH';
    $day->{total} = 0 unless defined $day->{total} && $day->{total} =~ /^\d+$/;
    return ($key, $day);
}

# Keep the file bounded: max 730 daily buckets (2 years), per-day key caps.
sub stats_cap {
    my ($stats) = @_;
    my @days = sort keys %{ $stats->{daily} };
    while (@days > 730) { delete $stats->{daily}{ shift @days }; }
    for my $d (values %{ $stats->{daily} }) {
        my @q = keys %{ $d->{questions} };
        while (@q > 300) { delete $d->{questions}{ shift @q }; }
        my @u = keys %{ $d->{unanswered} };
        while (@u > 200) { delete $d->{unanswered}{ shift @u }; }
    }
}

while (1) {
    my $client = $sock->accept() or next;
    $client->timeout(5);
    my $peer = $client->peerhost;
    my $req = <$client>;

    if (defined $req && $req =~ m{^POST\s+(\S+)\s+HTTP/1\.[01]}) {
        my $path = urldecode($1);
        $path =~ s/\?.*$//;
        if ($path ne '/stats.json') {
            print "$peer POST $path -> 404\n";
            http_error($client, 404, 'Not Found');
            close $client;
            next;
        }
        my $len = 0;
        my $guard = 0;
        while (my $line = <$client>) {
            last if $line =~ /^\r?$/;
            if ($line =~ /^Content-Length:\s*(\d+)/i) { $len = $1; }
            last if ++$guard > 100;
        }
        $len = 0 if $len !~ /^\d+$/ || $len > 65536;
        my $body = '';
        if ($len > 0) { read($client, $body, $len); }
        my $event = eval { JSON::PP->new->utf8->decode($body) };
        if ($event && ref $event eq 'HASH') {
            my $stats = stats_read();
            my ($dkey, $day) = stats_day($stats);
            if (defined $event->{id}) {
                my $k = "".$event->{id};
                $day->{questions}{$k} = ($day->{questions}{$k} || 0) + 1;
            } elsif (defined $event->{text}) {
                my $k = $event->{text};
                $k =~ s/^\s+|\s+$//g;
                $k = substr($k, 0, 120);
                $k = '?' unless length $k;
                $day->{unanswered}{$k} = ($day->{unanswered}{$k} || 0) + 1;
            } else {
                print "$peer POST stats.json -> 400 (no id/text)\n";
                http_error($client, 400, 'Bad Request');
                close $client;
                next;
            }
            $day->{total} = ($day->{total} || 0) + 1;
            $stats->{updated} = strftime("%Y-%m-%dT%H:%M:%S", localtime);
            stats_cap($stats);
            stats_write($stats);
            print "$peer POST stats.json -> 204 ($dkey, total day=$day->{total})\n";
            print $client "HTTP/1.0 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        } else {
            print "$peer POST stats.json -> 400 (bad json)\n";
            http_error($client, 400, 'Bad Request');
        }
        close $client;
        next;
    }

    if (defined $req && $req =~ m{^GET\s+(\S+)\s+HTTP/1\.[01]}) {
        my $path = urldecode($1);
        $path =~ s/\?.*$//;
        $path = '/index.html' if $path eq '/' || $path eq '';
        my $full = $root_full . $path;
        my $resolved = $full;
        $resolved =~ s{/\.\./}{/}g; # basic containment
        if ($resolved =~ /\.\./ || $resolved !~ /^\Q$root_full\E/) {
            print "$peer GET $path -> 403\n";
            http_error($client, 403, 'Forbidden');
            close $client;
            next;
        }
        # stats.json with no data yet -> empty object instead of 404
        if ($path eq '/stats.json' && !-f $resolved) {
            my $body = JSON::PP->new->utf8->encode({ daily => {}, updated => undef });
            print "$peer GET $path -> 200 (empty stats)\n";
            print $client "HTTP/1.0 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: " . length($body) . "\r\nConnection: close\r\n\r\n";
            print $client $body;
            close $client;
            next;
        }
        # directories -> index.html
        if (-d $resolved) {
            $resolved .= '/index.html';
        }
        if (-f $resolved) {
            open my $fh, '<:raw', $resolved or do {
                print "$peer GET $path -> 500\n";
                http_error($client, 500, 'Internal Server Error');
                close $client;
                next;
            };
            local $/;
            my $body = <$fh>;
            close $fh;
            my $ct = mime($resolved);
            print "$peer GET $path -> 200 ($ct, " . length($body) . " bytes)\n";
            print $client "HTTP/1.0 200 OK\r\nContent-Type: $ct\r\nContent-Length: " . length($body) . "\r\nConnection: close\r\n\r\n";
            print $client $body;
        } else {
            print "$peer GET $path -> 404\n";
            http_error($client, 404, 'Not Found');
        }
    } else {
        print "$peer -> ignored non-GET/non-POST/empty request\n";
        http_error($client, 400, 'Bad Request');
    }
    close $client;
}
