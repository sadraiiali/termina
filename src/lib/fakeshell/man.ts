/**
 * Full manual pages for the FakeShell lab shell.
 * Formatted like classic man(1) output (nroff-style sections).
 * Notes call out lab-only / fake backends where relevant.
 */

function page(title: string, section: number, body: string): string {
	const left = `${title.toUpperCase()}(${section})`
	const right = 'FakeShell Lab Manual'
	const width = 70
	const head = left + ' '.repeat(Math.max(2, width - left.length - right.length)) + right
	const footLeft = 'FakeShell 0.1'
	const footRight = left
	const foot =
		footLeft + ' '.repeat(Math.max(2, width - footLeft.length - footRight.length)) + footRight
	return `${head}\n\n${body.trimEnd()}\n\n${foot}\n`
}

/** Standard section builder for shorter pages */
function man(
	name: string,
	section: number,
	short: string,
	synopsis: string,
	description: string,
	extra: string = '',
): string {
	const indent = (block: string) =>
		block
			.split('\n')
			.map((l) => (l.length ? `       ${l}` : ''))
			.join('\n')

	let body =
		`NAME\n` +
		`       ${name} - ${short}\n\n` +
		`SYNOPSIS\n` +
		indent(synopsis) +
		`\n\n` +
		`DESCRIPTION\n` +
		indent(description)
	if (extra) body += `\n\n` + extra
	body +=
		`\n\n` +
		`LAB NOTES\n` +
		`       This is the FakeShell browser lab, not a full GNU/Linux system.\n` +
		`       Behaviour is intentionally simplified for learning.\n` +
		`\n` +
		`SEE ALSO\n` +
		`       help(1), man(1)\n`
	return page(name, section, body)
}

function opts(lines: string[]): string {
	return (
		`OPTIONS\n` +
		lines.map((l) => (l ? `       ${l.replace(/^\s+/, '')}` : '')).join('\n')
	)
}

function examples(lines: string[]): string {
	return `EXAMPLES\n` + lines.map((l) => (l ? `       ${l}` : '')).join('\n')
}

// ─── Network (full pages) ───────────────────────────────────────────────────

const MAN_IP = page(
	'ip',
	8,
	`
NAME
       ip - show / manipulate routing, network devices, interfaces and tunnels

SYNOPSIS
       ip [ OPTIONS ] OBJECT { COMMAND | help }

       OBJECT := { link | address | addr | route | neigh | rule }

       OPTIONS := { -V[ersion] | -h[uman-readable] | -s[tatistics] |
                    -d[etails] | -r[esolve] | -f[amily] { inet | inet6 | ... } |
                    -4 | -6 | -br[ief] | -o[neline] | -n[etns] name }

DESCRIPTION
       ip is a part of the iproute2 suite. On real Linux it talks to the kernel
       via netlink. In FakeShell it is a fake offline backend with the same
       command shape, backed by an in-memory network state.

OBJECTS
       link   Network device configuration and status.

       address
       addr   Protocol (IP or IPv6) addresses on a device.

       route  Routing table entries.

       neigh  Neighbour / ARP cache.

       rule   Routing policy database (RPDB) rules.

IP ADDRESS
       ip address { add | change | replace } IFADDR dev IFNAME
       ip address del IFADDR dev IFNAME
       ip address { show | flush } [ dev IFNAME ]

       ip a
       ip addr
       ip address show
              List addresses on all interfaces (lo, eth0 in the lab).

       ip -br addr
              Brief one-line listing.

       ip addr add 10.0.0.5/24 dev eth0
              Add an address to the fake eth0 (persists until reset).

       ip addr del 10.0.0.5/24 dev eth0
              Remove an address.

IP LINK
       ip link show [ dev IFNAME ]
       ip link set dev IFNAME { up | down }

       ip link
       ip l
              Show interfaces.

       ip link set eth0 down
       ip link set eth0 up
              Change administrative state of eth0 in the lab.

IP ROUTE
       ip route { list | flush } SELECTOR
       ip route { add | del | change | append | replace } ROUTE

       ip route
       ip r
              Show the routing table (default via 192.168.1.1, LAN route).

       ip route add default via 192.168.1.1 dev eth0
       ip route del default

IP NEIGH
       ip neigh show
              Show fake ARP/neighbour entries.

IP RULE
       ip rule show
              Show policy routing rules (local / main / default).

OPTIONS
       -4     Use IPv4 only (accepted; lab mostly IPv4).
       -6     Prefer IPv6 display where applicable.
       -br    Brief output.
       -s     Statistics (accepted).
       -h, help
              Show usage.

LAB TOPOLOGY
       lo      127.0.0.1/8 , ::1/128
       eth0    192.168.1.42/24 , link-local IPv6
       gateway 192.168.1.1

EXAMPLES
       ip addr
       ip -br link
       ip route
       ip link set eth0 down
       ip addr add 10.8.0.2/24 dev eth0

SEE ALSO
       iptables(8), ping(8), ip-address(8), ip-link(8), ip-route(8)

FakeShell
       Fake iproute2 — state is in RAM; shell command "reset" restores defaults.
`,
)

const MAN_IPTABLES = page(
	'iptables',
	8,
	`
NAME
       iptables - administration tool for IPv4 packet filtering and NAT

SYNOPSIS
       iptables [-t table] {-A|-C|-D} chain rule-specification
       iptables [-t table] -I chain [rulenum] rule-specification
       iptables [-t table] -R chain rulenum rule-specification
       iptables [-t table] -D chain rulenum
       iptables [-t table] -S [chain [rulenum]]
       iptables [-t table] {-F|-L|-Z} [chain [rulenum]] [options...]
       iptables [-t table] -N chain
       iptables [-t table] -X [chain]
       iptables [-t table] -P chain target
       iptables [-t table] -E old-chain-name new-chain-name
       iptables -h | --help
       iptables -V | --version

DESCRIPTION
       Iptables is used to set up, maintain, and inspect the tables of IPv4
       packet filter rules in the Linux kernel (netfilter).

       In FakeShell, iptables is a full CLI-shaped fake: tables, chains, policies
       and rules live in memory. Nothing is sent to a real kernel.

TABLES
       filter  Default table. Built-in chains: INPUT, FORWARD, OUTPUT.
       nat     Built-in: PREROUTING, INPUT, OUTPUT, POSTROUTING.
       mangle  Built-in: PREROUTING, INPUT, FORWARD, OUTPUT, POSTROUTING.
       raw     Built-in: PREROUTING, OUTPUT.

COMMANDS
       -A, --append chain rule-specification
              Append rule to the end of the selected chain.

       -I, --insert chain [rulenum] rule-specification
              Insert rule at rulenum (default 1 = head of chain).

       -D, --delete chain rule-specification
       -D, --delete chain rulenum
              Delete matching rule or rule number.

       -L, --list [chain]
              List rules. Combine with -n, -v, --line-numbers.

       -S, --list-rules [chain]
              Print rules in iptables-save / -A form.

       -F, --flush [chain]
              Delete all rules in chain or all chains.

       -Z, --zero [chain]
              Zero packet and byte counters.

       -N, --new-chain chain
              Create a user-defined chain.

       -X, --delete-chain [chain]
              Delete user-defined chain (must be empty).

       -P, --policy chain target
              Set policy for built-in chain (ACCEPT, DROP, REJECT).

       -C, --check chain rule-specification
              Check whether a rule matching the specification exists.
              Exit status 0 if found, 1 otherwise.

PARAMETERS (rule-specification)
       -p, --protocol protocol
              tcp, udp, icmp, all, ...

       -s, --source address[/mask]
              Source specification.

       -d, --destination address[/mask]
              Destination specification.

       -i, --in-interface name
              Incoming interface (e.g. eth0, lo).

       -o, --out-interface name
              Outgoing interface.

       -j, --jump target
              Target: ACCEPT, DROP, REJECT, RETURN, or user chain.

       --dport port
       --sport port
              TCP/UDP port match (lab simplified).

       -m state --state STATE
              Connection state match (RELATED,ESTABLISHED, ...).

OPTIONS
       -t, --table table
              Table to manipulate (default: filter).

       -n, --numeric
              Numeric output of addresses and ports.

       -v, --verbose
              Verbose list (packet/byte counters).

       -x, --exact
              Expand numbers exactly (with -v).

       --line-numbers
              Show rule numbers when listing.

       -V, --version
              Print version string.

       -h, --help
              Print help text.

EXAMPLES
       iptables -L -n -v
       iptables -L INPUT --line-numbers
       iptables -S
       iptables -t nat -L
       iptables -A INPUT -p tcp --dport 80 -j ACCEPT
       iptables -I INPUT 1 -s 10.0.0.0/8 -j DROP
       iptables -D INPUT 1
       iptables -P FORWARD DROP
       iptables -F
       iptables -N MYCHAIN
       iptables -A MYCHAIN -j RETURN
       iptables -X MYCHAIN

DEFAULT LAB RULES (filter/INPUT)
       -A INPUT -i lo -j ACCEPT
       -A INPUT -m state --state RELATED,ESTABLISHED -j ACCEPT
       -A INPUT -p tcp --dport 22 -j ACCEPT

SEE ALSO
       ip6tables(8), iptables-save(8), ip(8), ping(8)

FakeShell
       Fake netfilter. Changes persist until "iptables -F" or shell "reset".
`,
)

const MAN_IP6TABLES = page(
	'ip6tables',
	8,
	`
NAME
       ip6tables - IPv6 packet filter administration

SYNOPSIS
       ip6tables [-t table] COMMAND chain [rule-specification] [options]
       (Same command set as iptables(8).)

DESCRIPTION
       ip6tables is used to set up, maintain, and inspect tables of IPv6 packet
       filter rules. In FakeShell it is a separate fake netfilter store from
       iptables (IPv4), with the same CLI.

       Tables and built-in chains match real Linux: filter, nat, mangle, raw.

EXAMPLES
       ip6tables -L -n
       ip6tables -A INPUT -i lo -j ACCEPT
       ip6tables -P INPUT DROP
       ip6tables -S

SEE ALSO
       iptables(8), ip(8)

FakeShell
       Fake IPv6 netfilter. Reset with shell command "reset".
`,
)

const MAN_PING = page(
	'ping',
	8,
	`
NAME
       ping - send ICMP ECHO_REQUEST to network hosts

SYNOPSIS
       ping [options] destination
       ping -c count destination
       ping -n destination

DESCRIPTION
       ping uses the ICMP protocol's mandatory ECHO_REQUEST datagram to elicit
       an ICMP ECHO_RESPONSE from a host or gateway.

       On real systems ping may run until interrupted (Ctrl+C). In FakeShell the
       default is a bounded count of 4 replies from a fake ICMP backend. No
       real packets leave the browser.

OPTIONS
       -c count
              Stop after sending count ECHO_REQUEST packets (lab max 20).

       -n     Numeric output only (accepted).

       -q     Quiet (accepted; lab still prints standard lines).

       -W timeout
       -i interval
       -s packetsize
              Accepted and ignored in the lab.

OUTPUT
       For each reply the lab prints:

              64 bytes from ADDR: icmp_seq=N ttl=64 time=X.X ms

       After completion, a statistics summary is printed (transmitted,
       received, loss, rtt min/avg/max/mdev).

DNS
       The lab resolves common names (google.com, example.com, github.com,
       localhost, ...) and synthesizes stable addresses for other hostnames.

EXAMPLES
       ping google.com
       ping -c 3 1.1.1.1
       ping -c 5 example.com

EXIT STATUS
       0  At least one reply received
       1  No replies
       2  Usage or name resolution error

SEE ALSO
       ip(8), curl(1)

FakeShell
       Fake ICMP. Default -c 4. Abort with Ctrl+C when supported by the UI.
`,
)

const MAN_CURL = page(
	'curl',
	1,
	`
NAME
       curl - transfer a URL

SYNOPSIS
       curl [options / URLs]
       curl [options] URL

DESCRIPTION
       curl is a tool to transfer data from or to a server, using one of the
       supported protocols (HTTP and HTTPS in this lab).

       FakeShell provides a fake HTTP backend: no real network is used. Responses
       are generated offline for learning.

OPTIONS
       -s, --silent
              Silent mode (no progress meter).

       -I, --head
              Fetch headers only (HEAD).

       -i, --include
              Include response headers in the output.

       -o, --output <file>
              Write response body to file in the VFS.

       -O     Write to a file named like the remote path.

       -L, --location
              Follow redirects (accepted; lab rarely redirects).

       -X, --request <method>
              Specify request method (GET, POST, HEAD, ...).

       -H, --header <header>
              Extra header (accepted).

       -d, --data <data>
              HTTP POST data (method becomes POST if still GET).

       -k, --insecure
              Allow "insecure" TLS (no-op in lab).

       -v, --verbose
              Verbose (accepted).

       -m, --max-time <seconds>
              Maximum time (accepted).

PROTOCOLS
       http://  and  https://  URLs are supported.
       Bare hostnames are treated as http://host

EXAMPLES
       curl https://example.com
       curl -s https://example.com
       curl -I https://google.com
       curl -o page.html https://example.com
       curl https://example.com/api/status.json

EXIT STATUS
       0   Success
       3   Bad URL
       6   Could not resolve host
       22  HTTP error (4xx/5xx) when applicable
       23  Write error (-o)

SEE ALSO
       ping(8), wget(1)

FakeShell
       Offline fake HTTP. Bodies are synthetic HTML/JSON for practice.
`,
)

// ─── Core commands ──────────────────────────────────────────────────────────

const PAGES: Record<string, string> = {
	ip: MAN_IP,
	iptables: MAN_IPTABLES,
	ip6tables: MAN_IP6TABLES,
	ping: MAN_PING,
	curl: MAN_CURL,

	apt: page(
		'apt',
		8,
		`
NAME
       apt - command-line interface (FakeShell lab fake package manager)

SYNOPSIS
       apt [options] update
       apt [options] install|remove|purge pkg...
       apt [options] search|show|list|policy [pkg]
       apt upgrade | autoremove | clean

DESCRIPTION
       apt provides a high-level command-line interface for the package
       management system. On real Ubuntu/Debian systems it drives dpkg.

       In FakeShell this is a teaching simulation: packages are not downloaded
       from the internet. install may create sample config files under /etc
       (e.g. nginx).

COMMANDS
       update     Refresh package lists (fake mirror hit)
       install    Install packages (-y assumed in lab)
       remove     Remove packages
       purge      Remove packages and config files
       search     Search names/descriptions
       show       Show package details
       list       List installed packages (--installed default)
       policy     Show candidate / installed version
       upgrade    No-op success (lab)

EXAMPLES
       sudo apt update
       sudo apt install -y nginx
       apt search ssh
       apt show git
       dpkg -l
       apt remove nginx

SEE ALSO
       apt-get(8), dpkg(1), sources.list(5)

LAB NOTES
       Not real APT. reset restores default installed set.
`,
	),

	'apt-get': page(
		'apt-get',
		8,
		`
NAME
       apt-get - APT package handling utility (lab fake)

SYNOPSIS
       apt-get update
       apt-get install|remove|purge [-y] pkg...
       apt-get upgrade | clean | autoremove

DESCRIPTION
       Classic low-level frontend. In FakeShell, same backend as apt(8).

EXAMPLES
       apt-get update
       apt-get install -y curl

SEE ALSO
       apt(8), dpkg(1)
`,
	),

	dpkg: page(
		'dpkg',
		1,
		`
NAME
       dpkg - package manager for Debian (lab subset)

SYNOPSIS
       dpkg -l
       dpkg -s package
       dpkg -L package

DESCRIPTION
       Lab supports listing (-l), status (-s), and file list (-L) only.

SEE ALSO
       apt(8)
`,
	),

	sys: page(
		'sys',
		1,
		`
NAME
       sys - inspect FakeShell fake Linux / WASI syscall host

SYNOPSIS
       sys help
       sys call NAME [args...]
       sys open PATH [flags] | read PATH | write PATH TEXT
       sys stat PATH | readdir [PATH] | chdir PATH | getcwd
       sys uname | pid | fds | errno | numbers | nr NAME
       sys trace on|off | pipe-demo | wasi-demo
       sys install-demo [hello|echo|all] [PATH]
       sys pilots
       sys runwasm PATH [arg...]

DESCRIPTION
       FakeShell does not run a real Linux kernel. Instead, file and process
       operations for the lab shell (and future WASM tools) go through a
       TypeScript SyscallKernel that maps open/read/write/stat/chdir/… onto
       the in-browser VirtualFS.

       WASI preview1 imports (fd_write, path_open, …) are also implemented
       so modules compiled for wasi_snapshot_preview1 can run against the
       same host.

       Built-in pilot modules (not GNU coreutils):
         hello  — print "hi"
         echo   — print argv like /bin/echo
         cat    — print file contents via WASI path_open/fd_read

       Shell shortcuts auto-install pilots then run them:
         wasi-hello | wasi-echo ARGS… | wasi-cat FILE…

       sys runwasm PATH loads a .wasm file from the lab filesystem and
       instantiates it with the fake WASI host (same VFS as cat/echo).

EXAMPLES
       sys write /tmp/a.txt hello
       sys read /tmp/a.txt
       sys call getpid
       sys wasi-demo
       sys install-demo all
       wasi-hello
       wasi-echo hello world
       wasi-cat /tmp/a.txt
       sys runwasm /usr/lib/fakeshell/wasi-echo.wasm hello world
       sys numbers

       Shell file tools and redirects also use this host:
       echo hello > /tmp/a.txt
       cat /tmp/a.txt
       cp /tmp/a.txt /tmp/b.txt

SEE ALSO
       uname(1), help(1), cat(1)
`,
	),

	crontab: page(
		'crontab',
		1,
		`
NAME
       crontab - maintain crontab files for individual users (Vixie Cron)

SYNOPSIS
       crontab [-u user] file
       crontab [-u user] [ -i ] { -e | -l | -r }

DESCRIPTION
       crontab is the program used to install, deinstall or list the tables
       used to drive the cron(8) daemon.  Each user can have their own crontab.

       In FakeShell the crontab is stored at
       /var/spool/cron/crontabs/<user> and a fake cron daemon runs while the
       lab page is open — jobs really execute shell commands on schedule.

OPTIONS
       -e     Edit the current crontab using nano (lab).
       -l     List the current crontab.
       -r     Remove the current crontab.
       -i     Prompt before remove (lab: always proceeds).
       -u user
              Operate on user's crontab (default: user).

       file   Install crontab from file.

CRON FORMAT
       m h dom mon dow  command

       minute        0-59
       hour          0-23
       day of month  1-31
       month         1-12
       day of week   0-7 (0 and 7 = Sunday)

       Lists (1,5), ranges (1-5), steps (*/5 or 0-30/5) are supported.

SPECIAL STRINGS
       @reboot    Run once when the lab session starts
       @hourly    0 * * * *
       @daily     0 0 * * *
       @weekly    0 0 * * 0
       @monthly   0 0 1 * *
       @yearly    0 0 1 1 *

EXAMPLES
       crontab -l
       crontab -e
              # then add:
              * * * * * date >> /tmp/cron-every-minute.log
              */2 * * * * echo hi >> /tmp/cron-tick.log
       crontab -r
       cat /var/log/cron

NOTES
       Jobs run about every 15 seconds check (and once shortly after boot).
       Keep the lab tab open for schedules to fire. Logs go to /var/log/cron.

SEE ALSO
       cron(8), systemctl(1)

FakeShell
       Working fake cron — not the host OS crontab.
`,
	),

	cron: page(
		'cron',
		8,
		`
NAME
       cron - daemon to execute scheduled commands (FakeShell lab)

DESCRIPTION
       On real Linux, cron(8) runs as a daemon and executes commands from
       crontabs. In FakeShell a background ticker performs the same role while
       the terminal is open.

       Manage user tables with crontab(1). Check service status with:

              systemctl status cron

SEE ALSO
       crontab(1), journalctl(1)
`,
	),

	systemctl: page(
		'systemctl',
		1,
		`
NAME
       systemctl - Control the systemd system and service manager

SYNOPSIS
       systemctl [OPTIONS...] COMMAND [UNIT...]

DESCRIPTION
       systemctl may be used to introspect and control the state of the
       systemd(1) system and service manager.

       In FakeShell this is a full CLI-shaped fake: units, enablement, and
       journal tags live in memory. There is no real PID 1 daemon.

COMMANDS
       list-units [--type=TYPE] [--all] [--failed]
              List units currently in memory.

       list-unit-files [--type=TYPE]
              List installed unit files and enablement state.

       status [UNIT...]
              Show runtime status (and recent journal lines).

       start / stop / restart / reload UNIT...
              Change activation state of units.

       enable / disable [--now] UNIT...
              Enable or disable units for boot; --now also start/stop.

       is-active / is-enabled / is-failed UNIT...
              Check state (exit codes match common systemd practice).

       get-default / set-default TARGET
              Show or set the default boot target.

       daemon-reload
              Reload unit files (lab: success no-op).

       cat UNIT...
              Show unit file contents.

       show [UNIT...]
              Show low-level properties.

       isolate TARGET
              Start one target (simplified).

OPTIONS
       --no-pager
              Do not pipe output through less (print to the terminal).

PAGER
       On a real system, systemctl uses $SYSTEMD_PAGER (often less). In FakeShell,
       multi-line systemctl output opens the built-in less pager automatically
       (full-screen; press q to quit). One-line answers (is-active, get-default)
       print inline. Use --no-pager to force raw output.

EXAMPLES
       systemctl list-units --type=service
       systemctl status ssh
       systemctl start nginx
       systemctl enable --now nginx
       systemctl is-enabled ssh
       systemctl get-default
       systemctl set-default multi-user.target
       systemctl cat ssh.service
       systemctl status ssh --no-pager

SEE ALSO
       journalctl(1), systemd(1), less(1), systemd.service(5)

FakeShell
       Fake systemd. reset restores default units and journal.
`,
	),

	journalctl: page(
		'journalctl',
		1,
		`
NAME
       journalctl - Query the systemd journal

SYNOPSIS
       journalctl [OPTIONS...]

DESCRIPTION
       journalctl may be used to query the contents of the systemd(1) journal
       as written by systemd-journald.service(8).

       In FakeShell the journal is an in-memory ring of fake log lines seeded at
       boot and updated when you start/stop units.

OPTIONS
       -u, --unit=UNIT     Show logs for a unit
       -b, --boot          Current boot only
       -n, --lines=N       Show only the most recent N lines
       -p, --priority=LVL  Filter by priority (err, warning, info, …)
       -f, --follow        Follow (lab: snapshot + note)
       -r, --reverse       Newest first
       -x, -xe             Add short explanations for errors

EXAMPLES
       journalctl -b -n 20
       journalctl -u ssh -n 10
       journalctl -u nginx.service
       journalctl -b -p err
       journalctl -xe
       journalctl -b -n 50 --no-pager

PAGER
       Multi-line output opens the lab less pager (q to quit), like a real TTY.
       Use --no-pager for a raw dump.

SEE ALSO
       systemctl(1), less(1), systemd-journald.service(8)

FakeShell
       Fake journal — not on-disk journald binary logs.
`,
	),

	systemd: page(
		'systemd',
		1,
		`
NAME
       systemd - systemd system and service manager (lab overview)

SYNOPSIS
       /usr/lib/systemd/systemd  (not started in browser)
       Use systemctl(1) and journalctl(1) to interact with the fake manager.

DESCRIPTION
       systemd is a system and service manager for Linux. On real systems it
       runs as PID 1. FakeShell fakes the control plane only:

         • Units (.service, .target, .timer, .socket)
         • systemctl verbs used in courses
         • journalctl log queries
         • ps shows systemd as PID 1

       The full upstream systemd C codebase is intentionally not vendored
       (hundreds of MB). Behaviour is aligned with common CLI usage for
       learning Linux Terminal Mastery chapters 8 and 15.

SEE ALSO
       systemctl(1), journalctl(1)
`,
	),

	less: page(
		'less',
		1,
		`
NAME
       less - opposite of more (file pager)

SYNOPSIS
       less [filename]
       more [filename]

DESCRIPTION
       Less is a program similar to more(1), but which allows backward
       movement in the file as well as forward movement. Also, less does
       not have to read the entire input file before starting, so with large
       input files it starts up faster than text editors like vi(1).

       In FakeShell, less is an interactive full-screen pager over the VFS.

COMMANDS
       h  H                 Display help summary.
       q  Q                 Exit.
       SPACE  f  ^F         Forward one window.
       b  ^B  PageUp        Backward one window.
       j  e  CR  Down       Forward one line.
       k  y  Up             Backward one line.
       d  ^D                Forward one half-window.
       u  ^U                Backward one half-window.
       g  <  Home           Go to first line.
       G  >  End            Go to last line in file.
       /pattern             Search forward for pattern.
       ?pattern             Search backward for pattern.
       n                    Repeat previous search (same direction).
       N                    Repeat previous search (opposite direction).
       =  ^G                Print file name and position.
       Ctrl+C               Exit (lab).

EXAMPLES
       less /etc/passwd
       less ~/Documents/welcome.txt
       more /var/log/syslog

SEE ALSO
       more(1), cat(1), nano(1), man(1)

FakeShell
       Lab subset of GNU less. more(1) is an alias for less.
`,
	),

	more: page(
		'more',
		1,
		`
NAME
       more - file perusal filter for crt viewing (lab: alias for less)

SYNOPSIS
       more file

DESCRIPTION
       Historically more is a forward-only pager. In FakeShell, more is an alias
       for less(1) and supports the same navigation keys.

SEE ALSO
       less(1)
`,
	),

	man: man(
		'man',
		1,
		'an interface to the system reference manuals',
		'man [section] page\nman -k keyword\nman -a page',
		`man is the system's manual pager. In FakeShell it prints built-in manual
pages for lab commands to the terminal (no external man-db).

Sections commonly used:
  1   Executable programs or shell commands
  8   System administration commands`,
		opts([
			'-k, --apropos keyword   Search short descriptions (lab: name match)',
			'-a                      Show all matches (lab: same as default)',
			'section                 Optional section number (1 or 8)',
		]) +
			`\n\n` +
			examples(['man ip', 'man 8 iptables', 'man curl', 'man -k ping', 'man man']),
	),

	help: man(
		'help',
		1,
		'list FakeShell lab shell commands',
		'help',
		`Print a short catalogue of built-in lab shell commands and tips.`,
		examples(['help']),
	),

	pwd: man(
		'pwd',
		1,
		'print name of current/working directory',
		'pwd',
		`Print the full pathname of the current working directory.`,
		examples(['pwd']),
	),

	cd: man(
		'cd',
		1,
		'change the shell working directory',
		'cd [dir]',
		`Change the current directory to dir. With no argument, change to $HOME.
Supports ~ and absolute/relative paths in the virtual filesystem.`,
		examples(['cd /etc', 'cd ~', 'cd ~/projects', 'cd ..']),
	),

	ls: man(
		'ls',
		1,
		'list directory contents',
		'ls [OPTION]... [FILE]...',
		`List information about FILEs (the current directory by default).`,
		opts([
			'-a, --all     do not ignore entries starting with .',
			'-l            use a long listing format',
		]) +
			`\n\n` +
			examples(['ls', 'ls -la', 'ls /etc', 'ls *.txt']),
	),

	cat: man(
		'cat',
		1,
		'concatenate files and print on the standard output',
		'cat [FILE]...',
		`Concatenate FILE(s) to standard output.`,
		examples(['cat /etc/os-release', 'cat file1 file2']),
	),

	echo: man(
		'echo',
		1,
		'display a line of text',
		'echo [SHORT-OPTION]... [STRING]...',
		`Echo the STRINGs to standard output.`,
		opts([
			'-n     do not output the trailing newline',
			'-e     enable interpretation of backslash escapes',
			'-E     disable escapes (default)',
		]) +
			`\n\n` +
			examples(['echo hello', 'echo -n "no nl"', 'echo -e "a\\tb"']),
	),

	printf: man(
		'printf',
		1,
		'format and print data',
		"printf FORMAT [ARGUMENT]...",
		`Format and print ARGUMENTs under control of the FORMAT string.
Lab supports %s %d %i %c %% and common \\n \\t escapes.`,
		examples(["printf '%s\\n' hello", "printf 'x=%d\\n' 42"]),
	),

	print: man(
		'print',
		1,
		'print arguments (lab; echo/printf hybrid)',
		'print [FORMAT] [ARGUMENT]...\nprint [STRING]...',
		`If the first argument contains %, behave like printf; otherwise like echo.`,
		examples(['print hello', "print '%s\\n' world"]),
	),

	mkdir: man(
		'mkdir',
		1,
		'make directories',
		'mkdir DIRECTORY...',
		`Create the DIRECTORY(ies), if they do not already exist.
Lab creates parents as needed (like mkdir -p).`,
		examples(['mkdir projects', 'mkdir -p a/b/c']),
	),

	touch: man(
		'touch',
		1,
		'change file timestamps / create empty file',
		'touch FILE...',
		`Create FILE if it does not exist. Lab does not update timestamps.`,
		examples(['touch notes.txt']),
	),

	rm: man(
		'rm',
		1,
		'remove files or directories',
		'rm [OPTION]... FILE...',
		`Remove (unlink) the FILE(s).`,
		opts([
			'-r, -R, --recursive   remove directories and their contents',
			'-f                    ignore nonexistent files (partial)',
		]) +
			`\n\n` +
			examples(['rm file.txt', 'rm -r dirname', 'rm a.*']),
	),

	cp: man(
		'cp',
		1,
		'copy files',
		'cp SOURCE DEST',
		`Copy SOURCE to DEST in the virtual filesystem.`,
		examples(['cp a.txt b.txt']),
	),

	mv: man(
		'mv',
		1,
		'move (rename) files',
		'mv SOURCE DEST',
		`Rename SOURCE to DEST, or move between paths.`,
		examples(['mv old.txt new.txt']),
	),

	head: man(
		'head',
		1,
		'output the first part of files',
		'head [OPTION]... [FILE]...',
		`Print the first 10 lines of each FILE to standard output.`,
		opts(['-n, --lines=N   print the first N lines']) +
			`\n\n` +
			examples(['head file.txt', 'head -n 5 file.txt']),
	),

	tail: man(
		'tail',
		1,
		'output the last part of files',
		'tail [OPTION]... [FILE]...',
		`Print the last 10 lines of each FILE to standard output.`,
		opts(['-n, --lines=N   print the last N lines']) +
			`\n\n` +
			examples(['tail file.txt', 'tail -n 20 /var/log/syslog']),
	),

	wc: man(
		'wc',
		1,
		'print newline, word, and byte counts',
		'wc [FILE]...',
		`Print newline, word, and byte counts for each FILE.`,
		examples(['wc file.txt']),
	),

	grep: man(
		'grep',
		1,
		'print lines that match patterns',
		'grep PATTERN FILE',
		`Search for PATTERN in FILE (lab: simple substring match).`,
		examples(['grep root /etc/passwd', 'grep error log.txt']),
	),

	tree: man(
		'tree',
		1,
		'list contents of directories in a tree-like format',
		'tree [DIRECTORY]',
		`List the contents of DIRECTORY in a tree. Default is the current directory.`,
		examples(['tree', 'tree /home', 'tree ~/projects']),
	),

	chmod: man(
		'chmod',
		1,
		'change file mode bits',
		'chmod MODE FILE...',
		`On real Linux, chmod changes permissions. In FakeShell the VFS has no mode
bits; chmod always succeeds so scripts using "chmod +x" keep working.`,
		examples(['chmod +x script.sh', 'chmod 755 script.sh']),
	),

	whoami: man(
		'whoami',
		1,
		'print effective user name',
		'whoami',
		`Print the user name associated with the current effective user ID.`,
		examples(['whoami']),
	),

	id: man(
		'id',
		1,
		'print real and effective user and group IDs',
		'id',
		`Print user and group information for the current user (lab fixed ids).`,
		examples(['id']),
	),

	hostname: man(
		'hostname',
		1,
		'show or set the system host name',
		'hostname',
		`Show the system hostname (fakeshell-lab in the lab).`,
		examples(['hostname']),
	),

	uname: man(
		'uname',
		1,
		'print system information',
		'uname [OPTION]...',
		`Print certain system information.`,
		opts(['-a, --all    print all information']) +
			`\n\n` +
			examples(['uname', 'uname -a']),
	),

	date: man(
		'date',
		1,
		'print or set the system date and time',
		'date',
		`Display the current time in the browser environment.`,
		examples(['date']),
	),

	cal: man(
		'cal',
		1,
		'display a calendar',
		'cal\ncal MONTH YEAR\ncal YEAR\ncal -y',
		`Display a simple calendar for the current month, a given month/year,
or a whole year.`,
		examples(['cal', 'cal 8 2026', 'cal 2026', 'cal -y']),
	),

	env: man(
		'env',
		1,
		'run a program in a modified environment / print environment',
		'env',
		`Print the current environment variables.`,
		examples(['env']),
	),

	printenv: man(
		'printenv',
		1,
		'print all or part of environment',
		'printenv',
		`Same as env in this lab: print environment variables.`,
		examples(['printenv']),
	),

	export: man(
		'export',
		1,
		'set export attribute for shell variables',
		'export name[=value]',
		`Mark each name to be passed to child processes. In the lab this sets
a shell environment variable.`,
		examples(['export LANG=fa_IR.UTF-8', 'export PATH=$PATH:/opt/bin']),
	),

	which: man(
		'which',
		1,
		'locate a command',
		'which COMMAND',
		`Show the full path of COMMAND if it is a known lab builtin.`,
		examples(['which ls', 'which iptables', 'which curl']),
	),

	history: man(
		'history',
		1,
		'display command history',
		'history',
		`Display the list of previously entered commands in this session.`,
		examples(['history']),
	),

	clear: man(
		'clear',
		1,
		'clear the terminal screen',
		'clear',
		`Clear the terminal screen (xterm buffer).`,
		examples(['clear']),
	),

	true: man(
		'true',
		1,
		'do nothing, successfully',
		'true',
		`Exit with a status code indicating success (0).`,
		examples(['true', 'true; echo $?']),
	),

	false: man(
		'false',
		1,
		'do nothing, unsuccessfully',
		'false',
		`Exit with a status code indicating failure (1).`,
		examples(['false', 'false; echo $?']),
	),

	test: man(
		'test',
		1,
		'check file types and compare values',
		'test EXPRESSION\n[ EXPRESSION ]',
		`Check file types and compare values. Exit status is 0 (true) or 1 (false).

File tests: -e -f -d -r -w -x
String tests: -z -n  STRING = STRING  STRING != STRING
Numeric: -eq -ne -lt -le -gt -ge
Negation: ! EXPRESSION`,
		examples([
			'test -f /etc/hosts; echo $?',
			'[ -d /tmp ] && echo yes',
			'[ "$a" = "$b" ]',
		]),
	),

	'[': man(
		'[',
		1,
		'check file types and compare values (test synonym)',
		'[ EXPRESSION ]',
		`Synonym for test; the last argument must be ]. See test(1).`,
		examples(['[ -e /etc/passwd ] && echo ok']),
	),

	sleep: man(
		'sleep',
		1,
		'delay for a specified amount of time',
		'sleep NUMBER',
		`Pause for NUMBER seconds. Lab caps sleep at 5 seconds.`,
		examples(['sleep 1']),
	),

	exit: man(
		'exit',
		1,
		'cause the shell to exit',
		'exit [n]',
		`Exit the shell with status n. Inside a script, stop the script with
that exit code.`,
		examples(['exit', 'exit 2']),
	),

	source: man(
		'source',
		1,
		'execute commands from a file in the current shell',
		'source filename [arguments]\n. filename [arguments]',
		`Read and execute commands from filename in the current shell environment.`,
		examples(['source ~/.bashrc', '. ./setup.sh']),
	),

	'.': man(
		'.',
		1,
		'source a file (see source)',
		'. filename [arguments]',
		`Equivalent to source. See source(1).`,
		examples(['. ./env.sh']),
	),

	bash: man(
		'bash',
		1,
		'GNU Bourne-Again SHell (lab subset)',
		'bash script.sh [args]\nbash -c command',
		`In FakeShell, bash runs shell scripts from the VFS with a mini interpreter:
variables, if/elif/else/fi, for/do/done, echo/printf, test, pipelines of
simple commands, and most lab builtins.

There is no full interactive bash REPL; use the FakeShell prompt instead.`,
		examples([
			'bash hello.sh',
			'bash -c "echo hi; ls"',
			'./script.sh',
		]),
	),

	sh: man(
		'sh',
		1,
		'shell (lab: same as bash)',
		'sh script.sh [args]\nsh -c command',
		`In this lab sh is an alias for the mini bash runner. See bash(1).`,
		examples(['sh hello.sh']),
	),

	nano: man(
		'nano',
		1,
		'Nano\'s ANOther editor — GNU nano–compatible lab UI',
		'nano [FILE]',
		`Screen layout and classic bindings match GNU nano 7.x as closely as
possible in a browser terminal (title bar, status, two help rows).

This is still a TypeScript UI over the lab VFS — not the C binary.`,
		opts([
			'^G Get Help          ^O Write Out',
			'^X Exit              ^R Read File',
			'^W Where Is (search) ^K Cut Text',
			'^U Paste (Uncut)     ^C Cursor Position',
			'^A/^E Line home/end  ^Y/^V Page up/down',
			'^_ Go To Line        ^L Refresh',
			'Title shows "Modified" when dirty; idle status line is empty',
			'like real nano. Paths under /home/user show as ~/',
		]) +
			`\n\n` +
			examples(['nano notes.txt', 'nano']),
	),

	vim: man(
		'vim',
		1,
		'Vi IMproved — lab UI with classic statusline',
		'vim FILE\nvi FILE',
		`Looks and behaves more like classic Vim: ~ filler lines, statusline
with ruler (line,col Top/Bot/%), -- INSERT --, : commands, and common
motions. Not the real Vim binary or full language.

Modes: normal, insert, cmdline.
Motions: hjkl 0 $ w b gg G Ctrl-F/B
Edit: i I a A o O x X dd yy p P
Search: /pattern  n  N
Write: :w  :w file  :q  :q!  :wq  ZZ  ZQ
Other: :set number  :set nonumber  :help`,
		examples(['vim file.txt', 'vi file.txt', ':set number']),
	),

	vi: man(
		'vi',
		1,
		'alias for lab vim',
		'vi FILE',
		`See vim(1).`,
		examples(['vi file.txt']),
	),

	ps: man(
		'ps',
		1,
		'report a snapshot of the current processes',
		'ps [options]\nps aux\nps -ef [--forest]\nps -p PID [-o cols]',
		`Display a snapshot of lab processes (systemd unit PIDs + shell).
Supports common BSD (aux) and UNIX (-ef) formats used in textbooks.`,
		opts([
			'a, x, u       BSD: all / no-tty / user format (e.g. ps aux)',
			'-e, -A        all processes',
			'-f            full format',
			'--forest, -H  ASCII process tree',
			'-p PID        select by PID',
			'-o list       custom columns: pid,ppid,comm,args,user,tty,…',
		]) +
			`\n\n` +
			examples([
				'ps',
				'ps aux',
				'ps -ef',
				'ps -ef --forest',
				'ps -p 1',
				'ps -p 1 -o pid,comm,args',
			]),
	),

	pgrep: man(
		'pgrep',
		1,
		'look up processes by name',
		'pgrep [-a] PATTERN',
		`List PIDs matching PATTERN (substring of comm/args). -a shows command line.`,
		examples(['pgrep ssh', 'pgrep -a nginx']),
	),

	pidof: man(
		'pidof',
		1,
		'find the process ID of a running program',
		'pidof name',
		`Print PIDs of processes named name.`,
		examples(['pidof systemd', 'pidof ssh']),
	),

	df: man(
		'df',
		1,
		'report file system disk space usage',
		'df',
		`Show fake disk usage for the fakeshell-vfs and tmpfs mounts.`,
		examples(['df']),
	),

	node: man(
		'node',
		1,
		'server-side JavaScript runtime (almostnode)',
		'node script.js\nnode -e CODE',
		`Run JavaScript against the almostnode runtime and virtual filesystem.`,
		examples(['node -e "console.log(1+1)"', 'node index.js']),
	),

	npm: man(
		'npm',
		1,
		'package manager for Node (lab subset)',
		'npm <command>',
		`Limited npm via almostnode: install, run, start, test, ls, init may be
available depending on the runtime.`,
		examples(['npm ls', 'npm run build']),
	),

	save: man(
		'save',
		1,
		'save the virtual filesystem snapshot',
		'save',
		`Persist the lab VFS to IndexedDB so files survive a page reload.`,
		examples(['save']),
	),

	reset: man(
		'reset',
		1,
		'reset lab filesystem and network state',
		'reset',
		`Clear the VFS snapshot, reseed the learning workspace, and reset the
fake network stack (ip / iptables state).`,
		examples(['reset']),
	),

	// Section aliases people type
	'ip-address': MAN_IP,
	'ip-link': MAN_IP,
	'ip-route': MAN_IP,
}

/** Short one-line descriptions for apropos / man -k */
const WHATIS: Record<string, string> = {
	ip: 'show / manipulate routing, network devices, interfaces (fake iproute2)',
	iptables: 'IPv4 packet filter administration (fake netfilter)',
	ip6tables: 'IPv6 packet filter administration (fake netfilter)',
	ping: 'send ICMP ECHO_REQUEST (fake)',
	curl: 'transfer a URL (fake HTTP)',
	less: 'opposite of more (file pager)',
	more: 'file perusal filter (lab: alias for less)',
	systemctl: 'control the systemd system and service manager (fake)',
	journalctl: 'query the systemd journal (fake)',
	systemd: 'systemd system and service manager (lab overview)',
	crontab: 'maintain crontab files for individual users (working lab cron)',
	cron: 'daemon to execute scheduled commands (lab ticker)',
	man: 'interface to the system reference manuals',
	help: 'list FakeShell lab shell commands',
	pwd: 'print name of current/working directory',
	cd: 'change the shell working directory',
	ls: 'list directory contents',
	cat: 'concatenate files and print on the standard output',
	echo: 'display a line of text',
	printf: 'format and print data',
	print: 'print arguments (lab)',
	mkdir: 'make directories',
	touch: 'create empty file',
	rm: 'remove files or directories',
	cp: 'copy files',
	mv: 'move (rename) files',
	head: 'output the first part of files',
	tail: 'output the last part of files',
	wc: 'print newline, word, and byte counts',
	grep: 'print lines that match patterns',
	tree: 'list contents of directories in a tree-like format',
	chmod: 'change file mode bits (lab no-op success)',
	whoami: 'print effective user name',
	id: 'print user and group IDs',
	hostname: 'show the system host name',
	uname: 'print system information',
	date: 'print the system date and time',
	cal: 'display a calendar',
	env: 'print the environment',
	printenv: 'print the environment',
	export: 'set export attribute for shell variables',
	which: 'locate a command',
	history: 'display command history',
	clear: 'clear the terminal screen',
	true: 'do nothing, successfully',
	false: 'do nothing, unsuccessfully',
	test: 'check file types and compare values',
	'[': 'test synonym',
	sleep: 'delay for a specified amount of time',
	exit: 'cause the shell to exit',
	source: 'execute commands from a file in the current shell',
	'.': 'source a file',
	bash: 'GNU Bourne-Again SHell (lab subset)',
	sh: 'shell (lab: same as bash)',
	nano: "Nano's ANOther editor (lab compatible)",
	vim: 'Vi IMproved (lab mini editor)',
	vi: 'alias for lab vim',
	ps: 'report a snapshot of the current processes',
	pgrep: 'look up processes by name',
	pidof: 'find the process ID of a running program',
	df: 'report file system disk space usage',
	node: 'JavaScript runtime (almostnode)',
	npm: 'package manager for Node (lab subset)',
	save: 'save the virtual filesystem snapshot',
	reset: 'reset lab filesystem and network state',
}

/**
 * Resolve a man page. Supports:
 *   man ls
 *   man 8 ip
 *   man -k ping
 */
export function getManPage(args: string[]): { stdout: string; stderr: string; exitCode: number } {
	const a = args.filter(Boolean)

	// apropos
	if (a[0] === '-k' || a[0] === '--apropos' || a[0] === '-f' || a[0] === '--whatis') {
		const q = (a[1] ?? '').toLowerCase()
		if (!q) {
			return {
				stdout: '',
				stderr: 'man: option requires an argument -- k\n',
				exitCode: 1,
			}
		}
		const hits = Object.entries(WHATIS)
			.filter(([name, desc]) => name.includes(q) || desc.toLowerCase().includes(q))
			.map(([name, desc]) => {
				const sec = sectionOf(name)
				return `${name} (${sec})            - ${desc}`
			})
		if (!hits.length) {
			return {
				stdout: '',
				stderr: `${q}: nothing appropriate.\n`,
				exitCode: 16,
			}
		}
		return { stdout: hits.join('\n') + '\n', stderr: '', exitCode: 0 }
	}

	// man [section] page
	let section: number | null = null
	let topic = ''
	if (a.length >= 2 && /^\d+$/.test(a[0])) {
		section = parseInt(a[0], 10)
		topic = a[1]
	} else {
		topic = a[0] ?? 'man'
	}

	if (!topic) {
		return {
			stdout: '',
			stderr: 'What manual page do you want?\nFor example, try \'man man\'.\n',
			exitCode: 1,
		}
	}

	const key = topic.toLowerCase()
	const text = PAGES[key]
	if (!text) {
		return {
			stdout: '',
			stderr: `No manual entry for ${topic}` + (section ? ` in section ${section}` : '') + `\n`,
			exitCode: 16,
		}
	}

	// Optional section check (soft): still show page if section mismatches
	if (section != null && section !== sectionOf(key)) {
		// Prefer exact section when we only have one page; still show it
	}

	return { stdout: text, stderr: '', exitCode: 0 }
}

function sectionOf(name: string): number {
	const s8 = new Set(['ip', 'iptables', 'ip6tables', 'ping', 'ip-address', 'ip-link', 'ip-route'])
	return s8.has(name) ? 8 : 1
}

/** All known page names (for completion). */
export function listManPages(): string[] {
	return Object.keys(WHATIS).sort()
}

/** Export short whatis for NET_MAN compatibility if needed. */
export const MAN_INDEX = WHATIS
