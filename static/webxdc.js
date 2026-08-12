// Local-dev shim only. Delta Chat injects window.webxdc at runtime —
// this file is excluded from the .xdc zip.
if (typeof window !== 'undefined' && !window.webxdc) {
	window.webxdc = (() => {
		let updateListener = () => {};
		let serial = 0;
		const updates = [];
		const selfAddr = `dev-${Math.random().toString(36).slice(2, 8)}@example.org`;
		const selfName = 'Local Tester';

		return {
			selfAddr,
			selfName,
			sendUpdateInterval: 0,
			sendUpdateMaxSize: 128000,
			sendUpdate(update, _descr) {
				serial += 1;
				const payload = {
					...update,
					serial,
					max_serial: serial,
					from: selfAddr
				};
				updates.push(payload);
				queueMicrotask(() => updateListener(payload));
			},
			setUpdateListener(cb, startSerial = 0) {
				updateListener = cb;
				for (const u of updates) {
					if (u.serial > startSerial) cb(u);
				}
				return Promise.resolve();
			},
			getAllUpdates() {
				return Promise.resolve(updates);
			},
			sendToChat(message) {
				console.log('webxdc.sendToChat(shim)', message);
				return Promise.resolve();
			},
			importFiles() {
				return Promise.resolve([]);
			}
		};
	})();
}
