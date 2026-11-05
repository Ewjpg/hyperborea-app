// Мост между приложением и сайтом внутри него. Сайт получает только сведения об обновлении
// и может попросить перезапуститься для установки — больше ничего из приложения ему не доступно.
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('HyperboreaApp', {
  // callback({state: 'available' | 'progress' | 'ready', version, percent})
  onUpdate(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('hyperborea:update', (_event, info) => callback(info));
    ipcRenderer.send('hyperborea:update-listening');
  },
  installUpdate() { ipcRenderer.send('hyperborea:update-install'); },
  laterUpdate() { ipcRenderer.send('hyperborea:update-later'); }
});
