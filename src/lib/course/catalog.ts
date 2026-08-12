export interface ChapterMeta {
	id: string
	order: number
	titleFa: string
	titleEn: string
	/** Suggested practice commands for the interactive terminal */
	practice: string[]
}

/** Course outline — Farsi titles for Linux Terminal Mastery */
export const CHAPTERS: ChapterMeta[] = [
	{
		id: '00-Preface',
		order: 0,
		titleFa: 'پیشگفتار',
		titleEn: 'Preface',
		practice: ['help', 'cat ~/Documents/welcome.txt', 'cat ~/TOOLS.txt'],
	},
	{
		id: '00-Introduction',
		order: 1,
		titleFa: 'مقدمه',
		titleEn: 'Introduction',
		practice: ['help', 'uname -a', 'whoami', 'hostname'],
	},
	{
		id: '01-Terminal-Basics',
		order: 2,
		titleFa: 'مبانی ترمینال',
		titleEn: 'Terminal Basics',
		practice: ['pwd', 'ls', 'ls -la', 'echo $USER', 'whoami', 'date'],
	},
	{
		id: '02-Linux-Filesystem',
		order: 3,
		titleFa: 'ساختار فایل‌سیستم',
		titleEn: 'Linux Filesystem',
		practice: ['ls /', 'ls /etc', 'cat /etc/os-release', 'cat /etc/hostname', 'tree /home'],
	},
	{
		id: '03-Navigation',
		order: 4,
		titleFa: 'پیمایش در سیستم',
		titleEn: 'Navigation',
		practice: ['pwd', 'cd /', 'cd ~', 'cd Documents', 'cd ..', 'cd ~/projects'],
	},
	{
		id: '04-File-Management',
		order: 5,
		titleFa: 'مدیریت فایل‌ها',
		titleEn: 'File Management',
		practice: [
			'mkdir ~/practice',
			'touch ~/practice/note.txt',
			'cp ~/Documents/welcome.txt ~/practice/',
			'ls ~/practice',
			'cat ~/practice/welcome.txt',
			'mv ~/practice/note.txt ~/practice/notes.txt',
		],
	},
	{
		id: '05-Permissions',
		order: 6,
		titleFa: 'مجوزها و مالکیت',
		titleEn: 'Permissions',
		practice: ['ls -la ~', 'ls -la /etc', 'id', 'whoami'],
	},
	{
		id: '06-Users-and-Groups',
		order: 7,
		titleFa: 'کاربران و گروه‌ها',
		titleEn: 'Users and Groups',
		practice: ['whoami', 'id', 'cat /etc/passwd', 'cat /etc/group'],
	},
	{
		id: '07-Package-Management',
		order: 8,
		titleFa: 'مدیریت بسته‌ها',
		titleEn: 'Package Management',
		practice: ['help', 'which node', 'node -e "console.log(1+1)"'],
	},
	{
		id: '08-Processes-and-Services',
		order: 9,
		titleFa: 'پردازش‌ها و سرویس‌ها',
		titleEn: 'Processes and Services',
		practice: [
			'ps',
			'ps aux',
			'ps -ef --forest',
			'ps -p 1 -o pid,comm,args',
			'pgrep -a ssh',
			'systemctl status ssh',
			'journalctl -u ssh -n 5',
		],
	},
	{
		id: '09-Linux-Networking',
		order: 10,
		titleFa: 'شبکه در لینوکس',
		titleEn: 'Networking',
		practice: [
			'ip addr',
			'ip link',
			'ip route',
			'iptables -L -n -v',
			'iptables -S',
			'ping -c 3 google.com',
			'curl -s https://example.com',
			'cat /etc/hosts',
		],
	},
	{
		id: '10-SSH-and-Remote-Access',
		order: 11,
		titleFa: 'SSH و دسترسی از راه دور',
		titleEn: 'SSH and Remote Access',
		practice: ['whoami', 'hostname', 'pwd'],
	},
	{
		id: '11-Bash-Scripting',
		order: 12,
		titleFa: 'اسکریپت‌نویسی Bash',
		titleEn: 'Bash Scripting',
		practice: [
			'cat ~/projects/demo/hello.sh',
			'echo "سلام $USER"',
			'cd ~/projects/demo',
			'ls',
		],
	},
	{
		id: '12-Automation-and-Cron',
		order: 13,
		titleFa: 'خودکارسازی و Cron',
		titleEn: 'Automation and Cron',
		practice: [
			'crontab -l',
			'crontab -e',
			'systemctl status cron',
			'cat /var/log/cron',
			'date',
		],
	},
	{
		id: '13-Linux-Security',
		order: 14,
		titleFa: 'امنیت لینوکس',
		titleEn: 'Linux Security',
		practice: ['id', 'ls -la /etc', 'cat /etc/passwd'],
	},
	{
		id: '14-Disk-and-Storage',
		order: 15,
		titleFa: 'دیسک و ذخیره‌سازی',
		titleEn: 'Disk and Storage',
		practice: ['df', 'ls /mnt', 'ls /media', 'tree /home/user'],
	},
	{
		id: '15-Boot-and-Systemd',
		order: 16,
		titleFa: 'Boot و Systemd',
		titleEn: 'Boot and Systemd',
		practice: [
			'systemctl list-units --type=service',
			'systemctl status ssh',
			'systemctl is-enabled ssh',
			'systemctl get-default',
			'journalctl -b -n 20',
			'journalctl -u ssh -n 10',
			'ps',
		],
	},
	{
		id: '16-Linux-Server-Administration',
		order: 17,
		titleFa: 'مدیریت سرور',
		titleEn: 'Server Administration',
		practice: ['ls /var/www', 'cat /var/log/syslog', 'hostname'],
	},
	{
		id: '17-Advanced-Linux-Tools',
		order: 18,
		titleFa: 'ابزارهای پیشرفته',
		titleEn: 'Advanced Tools',
		practice: [
			'grep login /var/log/syslog',
			'wc ~/Documents/welcome.txt',
			'head -n 3 ~/Documents/todo.txt',
			'tail -n 2 /var/log/syslog',
		],
	},
	{
		id: '18-Final-Projects',
		order: 19,
		titleFa: 'پروژه‌های نهایی',
		titleEn: 'Final Projects',
		practice: [
			'mkdir -p ~/projects/final',
			'cd ~/projects/final',
			'touch report.txt',
			'ls -la',
			'save',
		],
	},
]

export function getChapter(id: string): ChapterMeta | undefined {
	return CHAPTERS.find((c) => c.id === id)
}
