/*
 * 内置工具 — 旧站（../toolkit）工具的全新实现。
 * 每个工具就是一段 JS 源码 transform(input, params, ctx)，与用户自建工具走同一沙箱执行路径。
 * 旧实现是浏览器端 eval + DOM 写入；这里全部重写为纯函数，可同时服务 web / REST / MCP。
 */

export const BUILTIN_TOOLS = [
  {
    slug: 'json-pretty',
    name: 'JSON 美化 / 排序',
    category: '数据格式',
    io: { input: 'text', output: 'text' },
    desc: '把压缩或杂乱的 JSON 美化成清晰缩进结构，支持按键排序、自定义缩进，容错解析尾逗号等常见格式错误。',
    sampleIn: '{"b":2,"a":1,"list":[3,1,2]}',
    params: [
      { key: 'indent', label: '缩进', opts: '2,4,Tab' },
      { key: 'sort', label: '按键排序', opts: '否,是' },
    ],
    doc: 'JSON 美化 / 排序\n\n把任意 JSON 字符串格式化为可读结构。\n- indent：2 / 4 / Tab\n- sort：是否按键名字母序排序\n容错：自动剔除尾逗号后重试。',
    source: `function transform(input, params, ctx) {
  const s = String(input || '').trim();
  if (!s) return '';
  let data;
  try {
    data = JSON.parse(s);
  } catch (e) {
    // 容错：去掉对象/数组末尾的尾逗号再试一次
    try { data = JSON.parse(s.replace(/,\\s*([}\\]])/g, '$1')); }
    catch (e2) { throw new Error('JSON 解析失败: ' + e.message); }
  }
  if (params.sort === '是') data = sortKeys(data);
  const indent = params.indent === 'Tab' ? '\\t' : Number(params.indent || 2);
  return JSON.stringify(data, null, indent);

  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
      return out;
    }
    return v;
  }
}`,
  },

  {
    slug: 'base64',
    name: 'Base64 编解码',
    category: '编解码',
    io: { input: 'text', output: 'text' },
    desc: '在 Base64 与明文之间互转，自动判断方向，完整支持 UTF-8（中文、emoji）。',
    sampleIn: 'aGVsbG8gd29ybGQ=',
    params: [{ key: 'mode', label: '方向', opts: 'auto,encode,decode' }],
    doc: 'Base64 编解码\n\nauto 模式自动判断输入是编码还是明文；encode/decode 强制方向。使用 TextEncoder/TextDecoder 保证 UTF-8 正确。',
    source: `function transform(input, params, ctx) {
  const s = String(input || '').trim();
  if (!s) return '';
  const looksB64 = /^[A-Za-z0-9+/\\s]+={0,2}$/.test(s) && s.replace(/\\s/g, '').length % 4 === 0;
  const mode = params.mode === 'encode' ? 'encode'
    : params.mode === 'decode' ? 'decode'
    : (looksB64 ? 'decode' : 'encode');
  if (mode === 'decode') {
    const clean = s.replace(/\\s/g, '');
    const bin = atob(clean);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}`,
  },

  {
    slug: 'url-encode',
    name: 'URL 编解码',
    category: '编解码',
    io: { input: 'text', output: 'text' },
    desc: '对 URL 或查询参数做 percent-encoding 编解码，自动判断方向，支持整段 URL 与单个组件两种粒度。',
    sampleIn: 'https://example.com/搜索?q=你好 世界',
    params: [
      { key: 'mode', label: '方向', opts: 'auto,encode,decode' },
      { key: 'scope', label: '粒度', opts: '组件,整段' },
    ],
    source: `function transform(input, params, ctx) {
  const s = String(input || '').trim();
  if (!s) return '';
  const hasPct = /%[0-9A-Fa-f]{2}/.test(s);
  const mode = params.mode === 'encode' ? 'encode'
    : params.mode === 'decode' ? 'decode'
    : (hasPct ? 'decode' : 'encode');
  if (mode === 'decode') return decodeURIComponent(s.replace(/\\+/g, '%20'));
  return params.scope === '整段' ? encodeURI(s) : encodeURIComponent(s);
}`,
  },

  {
    slug: 'timestamp',
    name: '时间戳转换',
    category: '数据格式',
    io: { input: 'text', output: 'key-value' },
    desc: 'Unix 时间戳与日期时间互转，自动识别秒/毫秒，输出本地时间、UTC、ISO 8601 多种格式。',
    sampleIn: '1700000000',
    params: [{ key: 'tz', label: '时区', opts: '本地,UTC' }],
    doc: '时间戳转换\n\n输入 10/13 位时间戳→日期；输入日期字符串→时间戳。空输入返回当前时间。',
    source: `function transform(input, params, ctx) {
  const s = String(input || '').trim();
  let d;
  if (!s) d = new Date();
  else if (/^\\d{10}$/.test(s)) d = new Date(Number(s) * 1000);
  else if (/^\\d{13}$/.test(s)) d = new Date(Number(s));
  else {
    d = new Date(s.replace(/-/g, '/'));
    if (isNaN(d)) throw new Error('无法识别的时间格式: ' + s);
  }
  const pad = (n) => String(n).padStart(2, '0');
  const local = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  const rows = [
    ['秒级时间戳', String(Math.floor(d.getTime() / 1000))],
    ['毫秒时间戳', String(d.getTime())],
    ['本地时间', local],
    ['UTC', d.toUTCString()],
    ['ISO 8601', d.toISOString()],
  ];
  return { text: rows.map((r) => r[0] + '\\t' + r[1]).join('\\n'), view: { kind: 'kv', rows } };
}`,
  },

  {
    slug: 'sha256',
    name: 'SHA-256 哈希',
    category: '签名',
    io: { input: 'text', output: 'key-value' },
    desc: '对文本计算 SHA-256 / SHA-1 / SHA-512 摘要，使用浏览器同源的 WebCrypto 实现，纯本地不联网。',
    sampleIn: 'hello world',
    params: [{ key: 'algo', label: '算法', opts: 'SHA-256,SHA-1,SHA-512' }],
    source: `async function transform(input, params, ctx) {
  const algo = params.algo || 'SHA-256';
  const data = new TextEncoder().encode(String(input || ''));
  const buf = await crypto.subtle.digest(algo, data);
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const rows = [['算法', algo], ['长度', String(hex.length * 4) + ' bit'], ['摘要', hex]];
  return { text: hex, view: { kind: 'kv', rows } };
}`,
  },

  {
    slug: 'md5',
    name: 'MD5 摘要',
    category: '签名',
    io: { input: 'text', output: 'text' },
    desc: '计算文本的 MD5 摘要（纯 JS 实现，本地计算）。注意：MD5 已不适合安全用途，仅用于校验与去重。',
    sampleIn: 'hello world',
    params: [{ key: 'case', label: '大小写', opts: '小写,大写' }],
    source: `function transform(input, params, ctx) {
  // 纯 JS MD5（RFC 1321），支持 UTF-8
  const bytes = new TextEncoder().encode(String(input || ''));
  const hex = md5(bytes);
  return params.case === '大写' ? hex.toUpperCase() : hex;

  function md5(bytes) {
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
    const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
               5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
               4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
               6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    const n = bytes.length;
    const total = (((n + 8) >> 6) + 1) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes); buf[n] = 0x80;
    const bits = n * 8;
    new DataView(buf.buffer).setUint32(total - 8, bits >>> 0, true);
    new DataView(buf.buffer).setUint32(total - 4, Math.floor(bits / 4294967296), true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const dv = new DataView(buf.buffer);
    const rotl = (x, c) => (x << c) | (x >>> (32 - c));
    for (let off = 0; off < total; off += 64) {
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const M = dv.getUint32(off + g * 4, true);
        const tmp = D; D = C; C = B;
        B = (B + rotl((A + F + K[i] + M) >>> 0, S[i])) >>> 0;
        A = tmp;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const le = (x) => [x & 255, (x >> 8) & 255, (x >> 16) & 255, (x >>> 24) & 255];
    return [...le(a0), ...le(b0), ...le(c0), ...le(d0)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}`,
  },

  {
    slug: 'escape',
    name: '换行 / 转义转换',
    category: '文本',
    io: { input: 'text', output: 'text' },
    desc: '在真实换行与字面 \\n 转义之间互转，顺带处理 \\t、\\"，粘贴日志或拼 JSON 字符串时常用。',
    sampleIn: 'line1\\nline2\\nline3',
    params: [{ key: 'mode', label: '方向', opts: 'auto,转义→真实,真实→转义' }],
    source: `function transform(input, params, ctx) {
  const s = String(input || '');
  if (!s) return '';
  const hasLiteral = /\\\\n|\\\\t/.test(s);
  const mode = params.mode === '转义→真实' ? 'unescape'
    : params.mode === '真实→转义' ? 'escape'
    : (hasLiteral ? 'unescape' : 'escape');
  if (mode === 'unescape') {
    return s.replace(/\\\\r\\\\n/g, '\\n').replace(/\\\\n/g, '\\n')
            .replace(/\\\\t/g, '\\t').replace(/\\\\"/g, '"');
  }
  return s.replace(/\\\\/g, '\\\\\\\\').replace(/\\r?\\n/g, '\\\\n')
          .replace(/\\t/g, '\\\\t').replace(/"/g, '\\\\"');
}`,
  },

  {
    slug: 'yaml-to-json',
    name: 'YAML 转 JSON',
    category: '数据格式',
    io: { input: 'text', output: 'text' },
    desc: '把 YAML（常用子集：嵌套映射、列表、标量、注释）转换为格式化 JSON，K8s / CI 配置排查利器。',
    sampleIn: 'name: toolkit\nversion: 2\ntags:\n  - web\n  - cli\nmeta:\n  active: true',
    params: [{ key: 'indent', label: '缩进', opts: '2,4' }],
    doc: 'YAML 转 JSON\n\n支持 YAML 常用子集：嵌套 map、list、字符串/数字/布尔/null 标量、# 注释。不支持锚点、多行块标量。',
    source: `function transform(input, params, ctx) {
  const lines = String(input || '').split('\\n')
    .map((l) => l.replace(/\\t/g, '  '))
    .filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return '';
  let pos = 0;
  const val = parseBlock(0);
  return JSON.stringify(val, null, Number(params.indent || 2));

  function indentOf(l) { return l.match(/^ */)[0].length; }
  function scalar(s) {
    s = s.trim();
    if (s === '' ) return null;
    if (s === 'null' || s === '~') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\\d*\\.\\d+$/.test(s)) return parseFloat(s);
    if ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'"))) return s.slice(1, -1);
    // inline JSON 风格
    if (s[0] === '[' || s[0] === '{') { try { return JSON.parse(s.replace(/'/g, '"')); } catch {} }
    return s;
  }
  function parseBlock(indent) {
    const isList = lines[pos].trim().startsWith('- ') || lines[pos].trim() === '-';
    return isList ? parseList(indent) : parseMap(indent);
  }
  function parseList(indent) {
    const arr = [];
    while (pos < lines.length && indentOf(lines[pos]) === indent && lines[pos].trim().startsWith('-')) {
      const rest = lines[pos].trim().slice(1).trim();
      pos++;
      if (!rest) {
        arr.push(pos < lines.length && indentOf(lines[pos]) > indent ? parseBlock(indentOf(lines[pos])) : null);
      } else if (rest.includes(': ') || rest.endsWith(':')) {
        // 列表项内联 map：把第一行也算进去
        pos--; lines[pos] = ' '.repeat(indent + 2) + rest;
        arr.push(parseMap(indent + 2));
      } else arr.push(scalar(rest));
    }
    return arr;
  }
  function parseMap(indent) {
    const obj = {};
    while (pos < lines.length && indentOf(lines[pos]) === indent && !lines[pos].trim().startsWith('- ')) {
      const line = lines[pos].trim();
      const m = line.match(/^([^:]+):(.*)$/);
      if (!m) throw new Error('YAML 解析失败于: ' + line);
      const key = scalar(m[1]);
      const rest = m[2].trim();
      pos++;
      if (rest) obj[key] = scalar(rest);
      else obj[key] = (pos < lines.length && indentOf(lines[pos]) > indent) ? parseBlock(indentOf(lines[pos])) : null;
    }
    return obj;
  }
}`,
  },

  {
    slug: 'jwt-decode',
    name: 'JWT 解码',
    category: '签名',
    io: { input: 'text', output: 'key-value' },
    desc: '解析 JWT 的 header / payload，展示算法、签发方、过期时间等声明并给出过期判断。纯本地解析，不校验签名。',
    sampleIn: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiZXhwIjoxNzAwMDAwMDAwfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    params: [],
    source: `function transform(input, params, ctx) {
  const s = String(input || '').trim();
  const parts = s.split('.');
  if (parts.length < 2) throw new Error('不是合法的 JWT（应为 xxx.yyy.zzz）');
  const decode = (p) => {
    const b64 = p.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(p.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const header = decode(parts[0]);
  const payload = decode(parts[1]);
  const rows = [];
  for (const [k, v] of Object.entries(header)) rows.push(['header.' + k, String(v)]);
  for (const [k, v] of Object.entries(payload)) {
    let out = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if ((k === 'exp' || k === 'iat' || k === 'nbf') && typeof v === 'number') {
      out += ' (' + new Date(v * 1000).toISOString() + ')';
    }
    rows.push([k, out]);
  }
  if (payload.exp) rows.push(['状态', payload.exp * 1000 < Date.now() ? '已过期 ✗' : '有效期内 ✓']);
  return { text: rows.map((r) => r[0] + '\\t' + r[1]).join('\\n'), view: { kind: 'kv', rows } };
}`,
  },

  {
    slug: 'color-convert',
    name: '颜色格式互转',
    category: '图像',
    io: { input: 'text', output: 'key-value' },
    desc: '在 HEX / RGB / HSL 之间互转，并给出与黑白文字的对比度提示，设计还原时顺手校色。',
    sampleIn: '#F0552B',
    params: [],
    source: `function transform(input, params, ctx) {
  const s = String(input || '').trim();
  let r, g, b;
  let m;
  if ((m = s.match(/^#?([0-9a-fA-F]{6})$/))) {
    const v = parseInt(m[1], 16); r = v >> 16; g = (v >> 8) & 255; b = v & 255;
  } else if ((m = s.match(/^#?([0-9a-fA-F]{3})$/))) {
    r = parseInt(m[1][0] + m[1][0], 16); g = parseInt(m[1][1] + m[1][1], 16); b = parseInt(m[1][2] + m[1][2], 16);
  } else if ((m = s.match(/rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)/))) {
    r = +m[1]; g = +m[2]; b = +m[3];
  } else if ((m = s.match(/hsla?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)%[,\\s]+([\\d.]+)%/))) {
    [r, g, b] = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
  } else throw new Error('无法识别的颜色: ' + s + '（支持 #hex / rgb() / hsl()）');
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const [h, sl, l] = rgbToHsl(r, g, b);
  const lum = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  const cWhite = (1.05 / (L + 0.05)).toFixed(2);
  const cBlack = ((L + 0.05) / 0.05).toFixed(2);
  const rows = [
    ['HEX', hex],
    ['RGB', 'rgb(' + r + ', ' + g + ', ' + b + ')'],
    ['HSL', 'hsl(' + h + ', ' + sl + '%, ' + l + '%)'],
    ['对白色文字对比度', cWhite + ' : 1 ' + (cWhite >= 4.5 ? '✓' : '✗')],
    ['对黑色文字对比度', cBlack + ' : 1 ' + (cBlack >= 4.5 ? '✓' : '✗')],
  ];
  return { text: rows.map((x) => x[0] + '\\t' + x[1]).join('\\n'), view: { kind: 'kv', rows } };

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }
  function hslToRgb(h, s, l) {
    h = (h % 360) / 360;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
  }
}`,
  },

  {
    slug: 'word-counter',
    name: '字数统计',
    category: '文本',
    io: { input: 'text', output: 'key-value' },
    desc: '统计字符、单词、中文字数、行数与段落数，写文案、交稿前快速核对。',
    sampleIn: 'toolkit.fun 让每个开发者拥有自己的工具箱。\nPaste anything, we recognize it.',
    params: [],
    source: `function transform(input, params, ctx) {
  const s = String(input || '');
  const chars = [...s].length;
  const charsNoSpace = [...s.replace(/\\s/g, '')].length;
  const cjk = (s.match(/[\\u4e00-\\u9fff]/g) || []).length;
  const words = (s.match(/[A-Za-z0-9_'-]+/g) || []).length;
  const lines = s ? s.split('\\n').length : 0;
  const paras = s.split(/\\n\\s*\\n/).filter((p) => p.trim()).length;
  const rows = [
    ['字符数', String(chars)], ['字符数（不含空白）', String(charsNoSpace)],
    ['中文字数', String(cjk)], ['英文单词', String(words)],
    ['行数', String(lines)], ['段落数', String(paras)],
  ];
  return { text: rows.map((r) => r[0] + '\\t' + r[1]).join('\\n'), view: { kind: 'kv', rows } };
}`,
  },

  {
    slug: 'csv-table',
    name: 'CSV 转表格 / JSON',
    category: '数据格式',
    io: { input: 'text', output: 'text' },
    desc: '把 CSV / TSV 解析为对齐文本表格或 JSON 数组，自动识别分隔符与表头，支持带引号字段。',
    sampleIn: 'name,role,city\n林深,开发,杭州\n苏苑,"设计,视觉",上海',
    params: [{ key: 'out', label: '输出', opts: '表格,JSON' }],
    source: `function transform(input, params, ctx) {
  const text = String(input || '').replace(/\\r\\n/g, '\\n').trim();
  if (!text) return '';
  const delim = text.split('\\n')[0].includes('\\t') ? '\\t' : ',';
  const rows = parse(text, delim);
  if (!rows.length) return '';
  if (params.out === 'JSON') {
    const [head, ...body] = rows;
    return JSON.stringify(body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))), null, 2);
  }
  const width = [];
  for (const r of rows) r.forEach((c, i) => { width[i] = Math.max(width[i] || 0, cellW(c)); });
  const line = (r) => '| ' + r.map((c, i) => c + ' '.repeat(width[i] - cellW(c))).join(' | ') + ' |';
  const sep = '|' + width.map((w) => '-'.repeat(w + 2)).join('|') + '|';
  return [line(rows[0]), sep, ...rows.slice(1).map(line)].join('\\n');

  function cellW(s) { // 中文按 2 宽度对齐
    let w = 0;
    for (const ch of String(s)) w += /[\\u4e00-\\u9fff\\uff00-\\uffef]/.test(ch) ? 2 : 1;
    return w;
  }
  function parse(text, d) {
    const out = [[]];
    let cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === d) { out[out.length - 1].push(cur); cur = ''; }
      else if (c === '\\n') { out[out.length - 1].push(cur); cur = ''; out.push([]); }
      else cur += c;
    }
    out[out.length - 1].push(cur);
    return out.filter((r) => r.length > 1 || r[0] !== '');
  }
}`,
  },

  {
    slug: 'uuid',
    name: 'UUID 生成',
    category: '文本',
    io: { input: 'text', output: 'text' },
    desc: '批量生成 UUID v4，支持大小写与数量参数，输入被忽略。',
    sampleIn: '',
    params: [
      { key: 'count', label: '数量', opts: '1,5,10' },
      { key: 'case', label: '大小写', opts: '小写,大写' },
    ],
    source: `function transform(input, params, ctx) {
  const n = Math.min(Number(params.count || 1), 100);
  const list = Array.from({ length: n }, () => crypto.randomUUID());
  const out = list.join('\\n');
  return params.case === '大写' ? out.toUpperCase() : out;
}`,
  },

  {
    slug: 'ip-lookup',
    name: 'IP 归属查询',
    category: '网络',
    io: { input: 'text', output: 'key-value' },
    desc: '查询单个或多个 IP（换行分隔）的地理归属与运营商，走服务端白名单网络（ip-api.com），浏览器无跨域烦恼。',
    sampleIn: '8.8.8.8',
    params: [],
    sandbox: { net: true },
    flags: ['net'],
    doc: 'IP 归属查询\n\n输入 1~20 个 IP（每行一个）。数据来自 ip-api.com 免费接口，由服务端沙箱通过网络白名单代理请求。',
    source: `async function transform(input, params, ctx) {
  const ips = String(input || '').split('\\n').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!ips.length) throw new Error('请输入至少一个 IP 地址');
  const rows = [];
  if (ips.length === 1) {
    const d = await ctx.http('http://ip-api.com/json/' + ips[0] + '?lang=zh-CN');
    if (d.status !== 'success') throw new Error(d.message || '查询失败');
    rows.push(['IP', d.query], ['国家', d.country], ['地区', d.regionName + ' · ' + d.city],
      ['运营商', d.isp], ['组织', d.org || '—'], ['经纬度', d.lat + ', ' + d.lon], ['时区', d.timezone]);
  } else {
    const list = await ctx.http('http://ip-api.com/batch?lang=zh-CN', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ips.map((q) => ({ query: q }))),
    });
    for (const d of list) {
      rows.push([d.query, d.status === 'success' ? (d.country + ' ' + d.city + ' · ' + d.isp) : '查询失败']);
    }
  }
  return { text: rows.map((r) => r[0] + '\\t' + r[1]).join('\\n'), view: { kind: 'kv', rows } };
}`,
  },

  {
    slug: 'translate',
    name: '中英互译',
    category: 'AI',
    io: { input: 'text', output: 'text' },
    desc: '中英文互译，自动检测方向。由服务端翻译能力（百度翻译）驱动，API Key 不出服务器。',
    sampleIn: '把这段话翻译成英文：工具即代码。',
    params: [{ key: 'to', label: '目标语言', opts: 'auto,en,zh' }],
    sandbox: { net: true },
    flags: ['net'],
    source: `async function transform(input, params, ctx) {
  const s = String(input || '').trim();
  if (!s) return '';
  const to = params.to === 'auto' ? undefined : params.to;
  return ctx.translate(s, to);
}`,
  },

  {
    slug: 'ai-ask',
    name: 'AI 提问',
    category: 'AI',
    io: { input: 'text', output: 'text' },
    desc: '向大模型直接提问（GLM），适合解释报错、生成正则、快速总结。按 token 计费，走服务端能力接口。',
    sampleIn: '用一句话解释什么是幂等性',
    params: [{ key: 'style', label: '风格', opts: '简洁,详细' }],
    sandbox: { ai: true },
    flags: ['ai'],
    source: `async function transform(input, params, ctx) {
  const s = String(input || '').trim();
  if (!s) return '';
  const prompt = params.style === '详细'
    ? s
    : '请用尽量简洁的中文回答（3 句话以内）：' + s;
  return ctx.ai(prompt);
}`,
  },

  {
    slug: 'ai-summary',
    name: 'AI 文本摘要',
    category: 'AI',
    io: { input: 'text', output: 'text' },
    desc: '调用大模型对长文本做三句话摘要，支持中英文。每次调用按 token 计费。',
    sampleIn: '',
    params: [{ key: 'lang', label: '输出语言', opts: '中文,English' }],
    sandbox: { ai: true },
    flags: ['ai'],
    source: `async function transform(input, params, ctx) {
  const s = String(input || '').trim();
  if (!s) throw new Error('请输入要摘要的文本');
  const lang = params.lang === 'English' ? '用英文' : '用中文';
  return ctx.ai(lang + '将下面的内容总结为不超过三句话的摘要：\\n\\n' + s);
}`,
  },

  {
    slug: 'markdown',
    name: 'Markdown 预览',
    category: '文本',
    io: { input: 'text', output: 'text' },
    desc: '把 Markdown 渲染为 HTML（标题、粗斜体、代码、列表、链接、引用、表格常用子集），旧版依赖 CDN marked，现为内置纯函数实现。',
    sampleIn: '# 标题\n\n- 支持 **粗体** 与 *斜体*\n- `行内代码` 与链接 [toolkit](https://toolkit.fun)\n\n> 引用一行',
    params: [],
    source: `function transform(input, params, ctx) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let src = String(input || '').replace(/\\r\\n/g, '\\n');
  const codeBlocks = [];
  src = src.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, (m, code) => {
    codeBlocks.push('<pre><code>' + esc(code.replace(/^\\w*\\n/, '')) + '</code></pre>');
    return '\\u0000' + (codeBlocks.length - 1) + '\\u0000';
  });
  const inline = (s) => esc(s)
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>')
    .replace(/\\*([^*]+)\\*/g, '<i>$1</i>')
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
  const lines = src.split('\\n');
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const flushList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  for (const line of lines) {
    let m;
    if ((m = line.match(/^(#{1,6})\\s+(.*)$/))) { flushPara(); flushList(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); }
    else if ((m = line.match(/^\\s*[-*+]\\s+(.*)$/))) { flushPara(); if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); }
    else if ((m = line.match(/^\\s*\\d+\\.\\s+(.*)$/))) { flushPara(); if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); }
    else if ((m = line.match(/^>\\s?(.*)$/))) { flushPara(); flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); }
    else if (/^\\s*(---|\\*\\*\\*)\\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\\n').replace(/\\u0000(\\d+)\\u0000/g, (m, i) => codeBlocks[Number(i)]);
}`,
  },

  {
    slug: 'rmb-upper',
    name: '人民币大写',
    category: '文本',
    io: { input: 'text', output: 'text' },
    desc: '把数字金额转换为人民币大写（壹贰叁…元角分整），开票、填合同专用。移植自社区同名工具。',
    sampleIn: '1234.56',
    params: [],
    source: `function transform(input, params, ctx) {
  const money = parseFloat(String(input || '').replace(/[,，¥\\s]/g, ''));
  if (isNaN(money)) throw new Error('请输入数字金额，如 1234.56');
  if (money >= 999999999999999.9999) throw new Error('金额超出可处理范围');
  if (money === 0) return '零元整';
  const cnNums = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const cnIntRadice = ['', '拾', '佰', '仟'];
  const cnIntUnits = ['', '万', '亿', '兆'];
  const cnDecUnits = ['角', '分', '毫', '厘'];
  const s = String(money);
  let [integerNum, decimalNum = ''] = s.split('.');
  decimalNum = decimalNum.slice(0, 4);
  let out = '';
  if (parseInt(integerNum, 10) > 0) {
    let zeroCount = 0;
    for (let i = 0; i < integerNum.length; i++) {
      const n = integerNum[i];
      const p = integerNum.length - i - 1;
      const q = Math.floor(p / 4), m = p % 4;
      if (n === '0') zeroCount++;
      else {
        if (zeroCount > 0) out += cnNums[0];
        zeroCount = 0;
        out += cnNums[Number(n)] + cnIntRadice[m];
      }
      if (m === 0 && zeroCount < 4) out += cnIntUnits[q];
    }
    out += '元';
  }
  if (decimalNum) {
    let zeroPending = false;
    for (let i = 0; i < decimalNum.length; i++) {
      const n = decimalNum[i];
      if (n === '0') { zeroPending = out !== ''; continue; }
      if (zeroPending) { out += cnNums[0]; zeroPending = false; }
      out += cnNums[Number(n)] + cnDecUnits[i];
    }
  }
  if (!decimalNum || /^0*$/.test(decimalNum)) out += '整';
  return out.replace(/^元/, '');
}`,
  },

  {
    slug: 'regex-test',
    name: '正则测试',
    category: '文本',
    io: { input: 'text', output: 'text' },
    desc: '第一行写正则（/pattern/flags 或裸 pattern），其余行为待匹配文本，输出所有命中与分组。',
    sampleIn: '/\\\\d+/g\n订单 1024 已于 2026-07-02 发货，运单号 SF987654。',
    params: [],
    source: `function transform(input, params, ctx) {
  const lines = String(input || '').split('\\n');
  if (lines.length < 2) throw new Error('第一行写正则，后续行写待匹配文本');
  let pat = lines[0].trim(), flags = 'g';
  const m = pat.match(/^\\/(.*)\\/([a-z]*)$/);
  if (m) { pat = m[1]; flags = m[2] || 'g'; }
  if (!flags.includes('g')) flags += 'g';
  const re = new RegExp(pat, flags);
  const text = lines.slice(1).join('\\n');
  const out = [];
  let hit, count = 0;
  while ((hit = re.exec(text)) && count < 200) {
    count++;
    out.push('#' + count + ' @' + hit.index + '  ' + hit[0] + (hit.length > 1 ? '   分组: ' + hit.slice(1).join(' | ') : ''));
    if (hit[0] === '') re.lastIndex++;
  }
  return count ? '共 ' + count + ' 处匹配\\n' + out.join('\\n') : '无匹配';
}`,
  },
];
