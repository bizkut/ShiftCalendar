import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const directory = resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4174);
const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };

createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith('/assets/') && !path.startsWith('/_expo/') && !path.split('/').pop().includes('.')) path = '/index.html';
    const file = resolve(directory, '.' + path);
    if (!file.startsWith(directory + sep) || !(await stat(file)).isFile()) throw new Error('Not found');
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : await readFile(file));
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:' + port));
