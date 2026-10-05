// 로컬 실행용 작은 서버 (배포에는 쓰이지 않음): 정적 파일 + /api/*.js 함수 실행
// 사용: npm run dev  →  http://localhost:3000 (같은 와이파이의 스마트폰은 표시되는 '폰에서' 주소로 접속)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = import.meta.dirname;
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const mod = await import(`./api/${url.pathname.slice(5).replace(/\W/g, '')}.js`);
      const out = await mod.GET(new Request(url));
      res.writeHead(out.status, Object.fromEntries(out.headers));
      return res.end(Buffer.from(await out.arrayBuffer()));
    }
    const file = join(root, normalize(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root)) throw new Error('잘못된 경로');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(process.env.PORT || 3000, () => {
  const port = process.env.PORT || 3000;
  console.log(`오늘뉴스: http://localhost:${port}`);
  for (const nets of Object.values(networkInterfaces())) {
    for (const n of nets) if (n.family === 'IPv4' && !n.internal) console.log(`  폰에서: http://${n.address}:${port}`);
  }
});
