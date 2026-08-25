/*
 * Strona ustawień otwierana z aplikacji Pebble na telefonie.
 *
 * Jedzie jako `data:`-URI, a nie z serwera — i to jest decyzja, nie skrót.
 * Strona hostowana musiałaby stać pod adresem osiągalnym z telefonu **zanim**
 * ktokolwiek wpisze adres API, czyli dokładnie wtedy, gdy nic jeszcze nie jest
 * skonfigurowane. Adres z VPN-a tego warunku nie spełnia, a wystawianie
 * konfiguratora do publicznego internetu po to, żeby wkleić do niego token,
 * byłoby wymianą jednego problemu na gorszy.
 *
 * Kosztem jest brak podglądu na żywo i to, że strona nie potrafi sama nic
 * sprawdzić. Nie szkodzi: sprawdzenie połączenia jest na zegarku, pod
 * przyciskiem UP, i tam ma większą wartość — bo idzie tą samą drogą, którą potem
 * jadą prawdziwe żądania.
 */

/** `</script>` w wartości ustawienia rozwaliłoby stronę — stąd ucieczka. */
function embed(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

var TEMPLATE = [
  '<!doctype html>',
  '<html><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>AlphaPump</title>',
  '<style>',
  'body{margin:0;padding:20px;background:#232327;color:#f4f4f5;',
  'font:16px/1.45 -apple-system,Roboto,sans-serif}',
  'h1{font-size:20px;margin:0 0 4px}',
  'p{color:#a1a1aa;font-size:14px;margin:0 0 20px}',
  'label{display:block;margin:16px 0 6px;font-size:14px;color:#a1a1aa}',
  'input[type=text]{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;',
  'border:1px solid #46464d;background:#2f2f34;color:#f4f4f5;font-size:16px}',
  '.row{display:flex;align-items:center;gap:12px;margin:20px 0}',
  '.row input{width:20px;height:20px;accent-color:#f97316}',
  '.row span{font-size:15px}',
  '.hint{font-size:13px;color:#a1a1aa;margin-top:6px}',
  'button{width:100%;margin-top:24px;padding:14px;border:0;border-radius:16px;',
  'background:#f97316;color:#232327;font-size:16px;font-weight:600}',
  '</style></head><body>',
  '<h1>AlphaPump</h1>',
  '<p>Dictate a set from the watch. The values are recognised by the server and saved to your log.</p>',
  '<label for="url">API address</label>',
  '<input id="url" type="text" inputmode="url" autocapitalize="off" autocorrect="off"',
  ' placeholder="http://alphapump.netbird">',
  '<div class="hint">The same address the phone app uses. The watch reaches it through the phone.</div>',
  '<label for="key">API token</label>',
  '<input id="key" type="text" autocapitalize="off" autocorrect="off" placeholder="ap_…">',
  '<div class="hint">Phone app → Account → API tokens → create one for the watch.</div>',
  '<div class="row"><input id="confirm" type="checkbox">',
  '<span>Confirm on the watch before saving</span></div>',
  '<div class="hint">Off: a recognised set is saved the moment the watch understands it.</div>',
  '<button id="save">Save</button>',
  '<script>',
  'var current=__SETTINGS__;',
  'document.getElementById("url").value=current.apiUrl||"";',
  'document.getElementById("key").value=current.apiKey||"";',
  'document.getElementById("confirm").checked=current.confirm!==false;',
  'document.getElementById("save").addEventListener("click",function(){',
  'var out={apiUrl:document.getElementById("url").value.trim().replace(/\\/+$/,""),',
  'apiKey:document.getElementById("key").value.trim(),',
  'confirm:document.getElementById("confirm").checked};',
  'location.href="pebblejs://close#"+encodeURIComponent(JSON.stringify(out));});',
  '</script></body></html>',
].join('');

/** Gotowy adres do `Pebble.openURL`, z wypełnionymi bieżącymi ustawieniami. */
module.exports = function configPage(settings) {
  var html = TEMPLATE.replace('__SETTINGS__', embed(settings));
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
};
