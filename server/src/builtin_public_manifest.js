import crypto from 'node:crypto';

export const BUILTIN_PUBLIC_MANIFEST_VERSION = 'toolkit.builtin-public-manifest.v1';
export const BUILTIN_PUBLIC_TOOL_SCHEMA = 'toolkit.builtin-public-tool.v1';
export const BUILTIN_OFFICIAL_LICENSE = 'Apache-2.0';

const FORBIDDEN_SOURCE_PATTERNS = Object.freeze([
  { code: 'BUILTIN_DYNAMIC_IMPORT_FORBIDDEN', pattern: /\bimport\s*\(/ },
  { code: 'BUILTIN_REQUIRE_FORBIDDEN', pattern: /\brequire\s*\(/ },
  { code: 'BUILTIN_EVAL_FORBIDDEN', pattern: /\beval\s*\(/ },
  { code: 'BUILTIN_FUNCTION_CONSTRUCTOR_FORBIDDEN', pattern: /\bnew\s+Function\b/ },
  { code: 'BUILTIN_PROCESS_ENV_FORBIDDEN', pattern: /\bprocess\.env\b/ },
  { code: 'BUILTIN_BROWSER_STORAGE_FORBIDDEN', pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/ },
  { code: 'BUILTIN_DOM_ACCESS_FORBIDDEN', pattern: /\b(?:document|window)\s*\./ },
]);

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex')}`;
}

function sourceCapability(tool = {}) {
  const flags = new Set((tool.flags || []).map(String));
  if (tool.sandbox?.ai || flags.has('ai')) return 'ai';
  if (tool.sandbox?.net || flags.has('net')) return 'net';
  return 'local';
}

function externalCapabilityPolicy(tool = {}) {
  const capability = sourceCapability(tool);
  if (capability === 'local') return null;
  return {
    capability,
    defaultEnabled: false,
    requiresRuntimeProvider: true,
    secretHandling: 'runtime-provider-reference-only',
    publicPreviewBehavior: 'disabled-until-provider-configured',
  };
}

function hasSecretLikeMetadata(tool = {}) {
  const text = JSON.stringify({
    params: tool.params || [],
    sandbox: tool.sandbox || {},
    flags: tool.flags || [],
  });
  return /(?:api[_-]?key|secret|token|password|credential)\s*[:=]/i.test(text);
}

export function builtinPublicToolManifest(tool = {}) {
  const slug = String(tool.slug || '');
  const source = String(tool.source || '');
  const capability = sourceCapability(tool);
  return {
    schemaVersion: BUILTIN_PUBLIC_TOOL_SCHEMA,
    slug,
    name: String(tool.name || ''),
    category: String(tool.category || ''),
    description: String(tool.desc || tool.description || ''),
    io: {
      input: String(tool.io?.input || ''),
      output: String(tool.io?.output || ''),
    },
    sampleInputDigest: sha256(String(tool.sampleIn ?? '')),
    source: {
      type: 'javascript-transform',
      digest: sha256(source),
      byteLength: Buffer.byteLength(source, 'utf8'),
      entrypoint: 'transform',
    },
    runtime: {
      trustClass: 'official-builtin',
      capability,
      sandbox: {
        net: capability === 'net',
        ai: capability === 'ai',
      },
      externalCapability: externalCapabilityPolicy(tool),
    },
    license: {
      expression: BUILTIN_OFFICIAL_LICENSE,
      noticeRequired: false,
    },
    provenance: {
      type: 'git',
      path: `scripts/builtin_tools.js#${slug}`,
    },
  };
}

export function builtinPublicManifest(tools = []) {
  const entries = tools.map(builtinPublicToolManifest).sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    schemaVersion: BUILTIN_PUBLIC_MANIFEST_VERSION,
    packageName: 'toolkit-builtins',
    license: BUILTIN_OFFICIAL_LICENSE,
    tools: entries,
    manifestDigest: sha256(JSON.stringify(entries)),
  };
}

export function validateBuiltinPublicManifest(tools = []) {
  const issues = [];
  const slugs = new Set();
  for (const tool of tools) {
    const slug = String(tool.slug || '');
    const source = String(tool.source || '');
    if (!/^[a-z0-9-]+$/.test(slug)) issues.push({ slug, code: 'BUILTIN_SLUG_INVALID' });
    if (slugs.has(slug)) issues.push({ slug, code: 'BUILTIN_SLUG_DUPLICATE' });
    slugs.add(slug);
    if (!tool.name || !tool.category || !tool.desc) issues.push({ slug, code: 'BUILTIN_METADATA_INCOMPLETE' });
    if (!tool.io?.input || !tool.io?.output) issues.push({ slug, code: 'BUILTIN_IO_MISSING' });
    if (!/async\s+function\s+transform|function\s+transform/.test(source)) issues.push({ slug, code: 'BUILTIN_TRANSFORM_MISSING' });
    for (const rule of FORBIDDEN_SOURCE_PATTERNS) {
      if (rule.pattern.test(source)) issues.push({ slug, code: rule.code });
    }
    if (hasSecretLikeMetadata(tool)) issues.push({ slug, code: 'BUILTIN_SECRET_METADATA_FORBIDDEN' });
    const manifest = builtinPublicToolManifest(tool);
    if (manifest.runtime.capability === 'local' && (tool.sandbox?.net || tool.sandbox?.ai)) {
      issues.push({ slug, code: 'BUILTIN_LOCAL_CAPABILITY_MISMATCH' });
    }
    if (manifest.runtime.capability !== 'local') {
      if (!manifest.runtime.externalCapability || manifest.runtime.externalCapability.defaultEnabled !== false) {
        issues.push({ slug, code: 'BUILTIN_EXTERNAL_CAPABILITY_POLICY_REQUIRED' });
      }
      if (!['net', 'ai'].some((flag) => (tool.flags || []).includes(flag))) {
        issues.push({ slug, code: 'BUILTIN_EXTERNAL_FLAG_REQUIRED' });
      }
    }
  }
  return {
    schemaVersion: 'toolkit.builtin-public-manifest-validation.v1',
    ok: issues.length === 0,
    issues,
  };
}
