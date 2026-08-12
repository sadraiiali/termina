import type { VirtualFS } from 'almostnode'
import { seedAptFiles } from './apt'

/** Learning workspace: Linux-like tree for interactive lessons. */
export function seedDemoWorkspace(vfs: VirtualFS): void {
	const mkdir = (p: string) => vfs.mkdirSync(p, { recursive: true })
	const write = (p: string, c: string) => vfs.writeFileSync(p, c)

	mkdir('/home/user')
	mkdir('/home/user/Desktop')
	mkdir('/home/user/Documents')
	mkdir('/home/user/Downloads')
	mkdir('/home/user/projects')
	mkdir('/home/user/projects/demo')
	mkdir('/tmp')
	mkdir('/bin')
	mkdir('/usr/bin')
	mkdir('/usr/local/bin')
	mkdir('/etc')
	mkdir('/var/log')
	mkdir('/var/www')
	mkdir('/opt')
	mkdir('/root')
	mkdir('/media')
	mkdir('/mnt')
	mkdir('/dev')
	mkdir('/proc')
	mkdir('/sys')
	mkdir('/boot')
	mkdir('/lib')
	mkdir('/usr/sbin')
	mkdir('/sbin')

	write(
		'/etc/os-release',
		`NAME="FakeShell"
VERSION="0.3.0"
ID=fakeshell
ID_LIKE=debian
PRETTY_NAME="FakeShell 0.3 (TypeScript lab shell in browser)"
HOME_URL="https://github.com/sadraiiali/termina"
`,
	)

	// Fake apt/dpkg layout for package-management lessons
	seedAptFiles(write, mkdir)

	write(
		'/etc/hostname',
		`fakeshell-lab
`,
	)

	write(
		'/etc/passwd',
		`root:x:0:0:root:/root:/bin/bash
user:x:1000:1000:Learner:/home/user:/bin/bash
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
`,
	)

	write(
		'/etc/group',
		`root:x:0:
user:x:1000:
sudo:x:27:user
users:x:100:
`,
	)

	write(
		'/home/user/.profile',
		`# FakeShell profile
export HOME=/home/user
export USER=user
export PATH=/usr/local/bin:/usr/bin:/bin
export PWD=/home/user
export SHELL=/bin/bash
`,
	)

	write(
		'/home/user/.bashrc',
		`# Interactive shell config (learning lab)
alias ll='ls -la'
alias la='ls -a'
`,
	)

	write(
		'/home/user/Documents/welcome.txt',
		`خوش آمدید به Termina — آزمایشگاه تعاملی ترمینال لینوکس

پیشگفتار
--------
این محیط (سایت + FakeShell) پروژهٔ Termina است.
متن درس‌ها عمدتاً از پروژهٔ Linux Terminal Mastery اقتباس شده است.

پروژهٔ این وب‌سایت:
  https://github.com/sadraiiali/termina
  https://sadraii.ir/termina/

منبع محتوای آموزشی (درس‌ها):
  https://github.com/AsaEdgerunner/linux-terminal-mastery
  (Linux Terminal Mastery — AsaEdgerunner)

این فایل‌سیستم مجازی (FakeShell) است و در مرورگر اجرا می‌شود؛
نه لینوکس واقعی. دستورات پایه: pwd، ls، cd، cat، mkdir، touch، rm و …

ویرایشگر: nano و vim (رابط آموزشی — نه باینری واقعی)
راهنما: cat ~/TOOLS.txt   ·   man sys   ·   help
`,
	)

	write(
		'/home/user/TOOLS.txt',
		`FakeShell — TypeScript fake shell (this project)
==============================================
Project: https://github.com/sadraiiali/termina
Author:  https://github.com/sadraiiali
Course:  https://github.com/AsaEdgerunner/linux-terminal-mastery

Everything you type runs in FakeShell: a shell we wrote in TypeScript
under src/lib/fakeshell. Not a real Linux kernel, not real bash.

SYSCALL / WASI (TS host over VirtualFS)
  open/read/write/stat/chdir/… via SyscallKernel
  WASI pilots: wasi-hello · wasi-echo · wasi-cat
  sys help · sys install-demo all · sys runwasm PATH

EDITORS (lab UI — not GNU binaries)
  nano [file] · vim|vi <file>

SHELL (TS): ls cat mkdir -p cp mv rm · echo · > >> · globs
NETWORK (fake): ip iptables ping curl
SYSTEM (fake): systemctl journalctl crontab ps
PACKAGES (fake): sudo apt update · apt install -y nginx · dpkg -l

No real Ubuntu packages or ELF binaries run here.
`,
	)

	mkdir('/usr/lib/fakeshell')
	write(
		'/usr/lib/fakeshell/README',
		`WASI pilot modules (installed at boot by FakeShell).
Use: wasi-hello | wasi-echo | wasi-cat
Or:  sys runwasm /usr/lib/fakeshell/wasi-echo.wasm hello
`,
	)

	write(
		'/home/user/Documents/todo.txt',
		`1. خواندن فصل مقدمه
2. تمرین دستور pwd و ls
3. ساخت پوشه projects/demo
4. نوشتن یک اسکریپت ساده
`,
	)

	write(
		'/home/user/projects/demo/README.md',
		`# demo

پروژهٔ نمونه برای تمرین مدیریت فایل.

\`\`\`bash
cd ~/projects/demo
ls
cat README.md
\`\`\`
`,
	)

	write(
		'/home/user/projects/demo/hello.sh',
		`#!/bin/bash
# نمونه اسکریپت — اجرا: bash hello.sh  یا  ./hello.sh
echo "سلام از اسکریپت!"
printf 'کاربر: %s\n' "$USER"
print "cwd follows"
pwd
`,
	)

	write(
		'/var/log/syslog',
		`Jan 01 12:00:00 fakeshell-lab kernel: FakeShell booted
Jan 01 12:00:01 fakeshell-lab systemd: Started Session of user
Jan 01 12:00:02 fakeshell-lab login: user logged in
`,
	)

	write(
		'/etc/hosts',
		`127.0.0.1 localhost
127.0.1.1 fakeshell-lab
::1 localhost
`,
	)

	// Cron spool + sample note
	mkdir('/var/spool/cron/crontabs')
	mkdir('/etc/cron.d')
	mkdir('/etc/cron.daily')
	write(
		'/etc/crontab',
		`# /etc/crontab: system-wide crontab (lab reference; user crontab via crontab -e)
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# m h dom mon dow user  command
17 *	* * *	root	cd / && run-parts --report /etc/cron.hourly
`,
	)

	// Fake systemd unit tree (readable with cat; systemctl uses in-memory state)
	mkdir('/lib/systemd/system')
	mkdir('/etc/systemd/system')
	mkdir('/etc/systemd/system/multi-user.target.wants')
	mkdir('/run/systemd/system')
	write(
		'/lib/systemd/system/ssh.service',
		`[Unit]
Description=OpenBSD Secure Shell server
After=network.target

[Service]
Type=notify
ExecStart=/usr/sbin/sshd -D
ExecReload=/bin/kill -HUP $MAINPID

[Install]
WantedBy=multi-user.target
`,
	)
	write(
		'/lib/systemd/system/nginx.service',
		`[Unit]
Description=A high performance web server and a reverse proxy server
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
PIDFile=/run/nginx.pid
ExecStart=/usr/sbin/nginx
ExecReload=/usr/sbin/nginx -s reload

[Install]
WantedBy=multi-user.target
`,
	)
	write(
		'/lib/systemd/system/multi-user.target',
		`[Unit]
Description=Multi-User System
Requires=basic.target
Conflicts=rescue.target
After=basic.target rescue.target
AllowIsolate=yes
`,
	)
	write(
		'/etc/systemd/system/default.target',
		`# FakeShell lab: default boot target (symlink target text)
multi-user.target
`,
	)
	write(
		'/etc/systemd/system/multi-user.target.wants/ssh.service',
		`# wants ssh.service (lab placeholder file)
`,
	)

	// Mini Node playground (kept for advanced demos)
	mkdir('/home/user/app')
	write(
		'/home/user/app/package.json',
		JSON.stringify(
			{
				name: 'lab-app',
				version: '1.0.0',
				private: true,
				type: 'commonjs',
				main: 'index.js',
				scripts: { start: 'node index.js' },
			},
			null,
			2,
		) + '\n',
	)
	write(
		'/home/user/app/index.js',
		`const fs = require('fs');
console.log('Hello from FakeShell lab');
console.log('cwd:', process.cwd());
fs.writeFileSync(__dirname + '/output.txt', 'ok\\n');
console.log('wrote output.txt');
`,
	)
}
