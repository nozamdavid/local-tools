import { escapeStyleTagBreakout, sanitizeSampleHtml } from '../../lib/inertMarkup';

export const TEST_PRESETS: Record<string, { label: string; html: string }> = {
  card: {
    label: 'Profile / Product Card',
    html: `<div class="card">
  <span class="badge">Featured</span>
  <h2 class="title">Modern Component</h2>
  <p class="description">
    Inspect how your CSS renders locally inside a safe sandbox with instant live preview.
  </p>
  <button class="btn-primary">Get Started</button>
  <button class="btn-secondary">Learn More</button>
</div>`,
  },
  buttons: {
    label: 'Buttons & Badges',
    html: `<div style="display:flex; flex-direction:column; gap:1rem; align-items:flex-start;">
  <div>
    <span class="badge" style="background:#dcfce7; color:#15803d;">Active</span>
    <span class="badge" style="background:#fee2e2; color:#b91c1c;">Alert</span>
    <span class="badge">Info</span>
  </div>
  <div style="display:flex; gap:0.5rem;">
    <button class="btn-primary">Primary Button</button>
    <button class="btn-secondary">Secondary Button</button>
  </div>
</div>`,
  },
  form: {
    label: 'Interactive Form',
    html: `<div class="card" style="display:flex; flex-direction:column; gap:0.75rem;">
  <h2 class="title">Contact Support</h2>
  <div>
    <label style="display:block; font-size:0.85rem; font-weight:600; margin-bottom:0.25rem;">Email Address</label>
    <input type="email" placeholder="you@example.com" style="width:100%; box-sizing:border-box; padding:0.5rem; border:1px solid #cbd5e1; border-radius:6px;" />
  </div>
  <div>
    <label style="display:block; font-size:0.85rem; font-weight:600; margin-bottom:0.25rem;">Message</label>
    <textarea rows="3" placeholder="How can we help?" style="width:100%; box-sizing:border-box; padding:0.5rem; border:1px solid #cbd5e1; border-radius:6px;"></textarea>
  </div>
  <button class="btn-primary" type="button" style="margin-top:0.5rem;">Submit Inquiry</button>
</div>`,
  },
  typography: {
    label: 'Typography & Layout',
    html: `<div style="max-width:600px; margin:0 auto;">
  <span class="badge">Documentation</span>
  <h1 style="font-size:2rem; font-weight:800; margin:0.5rem 0 1rem 0;">Typography Overview</h1>
  <p style="font-size:1.1rem; line-height:1.6; color:#475569;">
    Clean typography establishes hierarchy and helps readers navigate content effortlessly.
  </p>
  <blockquote style="border-left:4px solid #3b82f6; padding-left:1rem; margin:1.5rem 0; font-style:italic; color:#64748b;">
    "Simplicity is the soul of efficiency." — Austin Freeman
  </blockquote>
</div>`,
  },
};

export interface CssViewerVerifyResults {
  styleTagBreakoutSuccess: boolean;
  sampleHtmlSanitizeSuccess: boolean;
  presetsValidSuccess: boolean;
  details: string[];
}

export async function runVerification(): Promise<CssViewerVerifyResults> {
  const details: string[] = [];
  const log = (msg: string) => {
    details.push(msg);
    console.log(msg);
  };

  log('=== Starting CSS Viewer Privacy & Boundary Verification ===');

  // -------------------------------------------------------------
  // Test 1: Robust Closing Style Tag Variant Neutralization
  // -------------------------------------------------------------
  log('\n--- Test 1: Closing </style> Tag Variant Breakout Defense ---');
  let styleTagBreakoutSuccess = false;
  try {
    const dangerousVariants = [
      '</style><img src="http://localhost:5300/canary-exact.png">',
      '</style ><img src="http://localhost:5300/canary-space.png">',
      '</style\t><img src="http://localhost:5300/canary-tab.png">',
      '</style\n><img src="http://localhost:5300/canary-newline.png">',
      '</style/x><img src="http://localhost:5300/canary-slash.png">',
      '</style id="leak"><img src="http://localhost:5300/canary-attr.png">',
      '</STYLE  ><img src="http://localhost:5300/canary-case.png">',
    ];

    for (const input of dangerousVariants) {
      const neutralized = escapeStyleTagBreakout(input);

      // Verify that </style was converted to <\/style
      if (/<\s*\/\s*style\b/i.test(neutralized)) {
        throw new Error(`Unescaped </style variant remains in: "${neutralized}"`);
      }
      if (!neutralized.startsWith('<\\/style')) {
        throw new Error(`Expected <\\/style prefix, got: "${neutralized}"`);
      }
    }
    log(`✓ Verified: All 7 closing </style> tag variants safely neutralized to prevent rawtext breakout.`);

    // Test with DOMParser if available in browser
    if (typeof DOMParser !== 'undefined') {
      for (const variant of dangerousVariants) {
        const escaped = escapeStyleTagBreakout(variant);
        const testHtml = `<!DOCTYPE html><html><head><style>${escaped}</style></head><body><p>Test</p></body></html>`;
        const parser = new DOMParser();
        const doc = parser.parseFromString(testHtml, 'text/html');

        // If the style tag broke out, an <img> element would appear in the document tree
        const leakedImg = doc.querySelector('img');
        if (leakedImg) {
          throw new Error(`Breakout succeeded! <img> found outside <style>: ${leakedImg.outerHTML}`);
        }
      }
      log('✓ Verified via DOMParser: Zero <img> elements escape <style> rawtext boundary.');
    }

    styleTagBreakoutSuccess = true;
  } catch (err) {
    log(`✗ Test 1 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // -------------------------------------------------------------
  // Test 2: Sample HTML Sanitization (Meta Refresh, Base, Forms, Links)
  // -------------------------------------------------------------
  log('\n--- Test 2: Sample HTML Sanitization ---');
  let sampleHtmlSanitizeSuccess = false;
  try {
    const maliciousHtml = `
      <base href="http://localhost:5300/canary-base/">
      <meta http-equiv="refresh" content="0;url=http://localhost:5300/canary-refresh">
      <form action="http://localhost:5300/canary-form" method="POST">
        <input name="leak" value="secret" />
      </form>
      <iframe src="http://localhost:5300/canary-frame.html"></iframe>
      <script>window.__canary_leaked = true;</script>
      <div onclick="window.__canary_leaked = true">Clickable</div>
      <a href="http://localhost:5300/canary-outbound" target="_blank">Outbound</a>
      <a href="#safe-anchor">Local Anchor</a>
    `;

    const sanitized = sanitizeSampleHtml(maliciousHtml);

    if (sanitized.includes('canary-base')) {
      throw new Error('<base> tag was not stripped from sample HTML');
    }
    if (sanitized.includes('canary-refresh')) {
      throw new Error('<meta http-equiv="refresh"> was not stripped from sample HTML');
    }
    if (sanitized.includes('canary-form') || /<form\b/i.test(sanitized)) {
      throw new Error('<form> tag was not stripped from sample HTML');
    }
    if (sanitized.includes('canary-frame') || /<iframe\b/i.test(sanitized)) {
      throw new Error('<iframe> tag was not stripped from sample HTML');
    }
    if (sanitized.includes('__canary_leaked') || /<script\b/i.test(sanitized)) {
      throw new Error('<script> tag was not stripped from sample HTML');
    }
    if (sanitized.includes('onclick=')) {
      throw new Error('Inline onclick handler was not stripped from sample HTML');
    }
    if (sanitized.includes('canary-outbound')) {
      throw new Error('Outbound link href was not neutralized to safe anchor');
    }
    if (!sanitized.includes('href="#safe-anchor"')) {
      throw new Error('Local anchor href="#safe-anchor" was incorrectly removed');
    }

    log('✓ Verified: Meta-refresh, base, forms, frames, scripts, and outbound links successfully sanitized.');
    sampleHtmlSanitizeSuccess = true;
  } catch (err) {
    log(`✗ Test 2 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // -------------------------------------------------------------
  // Test 3: Built-in Presets Validation
  // -------------------------------------------------------------
  log('\n--- Test 3: Built-in Presets Validation ---');
  let presetsValidSuccess = false;
  try {
    const presetKeys = Object.keys(TEST_PRESETS);
    if (presetKeys.length < 4) {
      throw new Error(`Expected at least 4 presets, found ${presetKeys.length}`);
    }

    for (const key of presetKeys) {
      const preset = TEST_PRESETS[key];
      if (!preset.label || !preset.html) {
        throw new Error(`Preset "${key}" is missing label or html content.`);
      }

      // Verify preset has no active scripts, forms, or network leaks
      const sanitized = sanitizeSampleHtml(preset.html);
      if (/<form\b/i.test(preset.html)) {
        throw new Error(`Preset "${key}" still contains raw <form> tag; should use styled container.`);
      }
      if (/<script\b/i.test(sanitized) || /http-equiv\s*=\s*["']?refresh/i.test(sanitized)) {
        throw new Error(`Preset "${key}" contains unsafe elements.`);
      }
    }

    log(`✓ Verified: All ${presetKeys.length} built-in HTML presets are valid, inert, and safe.`);
    presetsValidSuccess = true;
  } catch (err) {
    log(`✗ Test 3 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  log('\n=== Summary of CSS Viewer Verification ===');
  log(`1. Closing Style Tag Breakout Defense:   ${styleTagBreakoutSuccess ? 'PASS' : 'FAIL'}`);
  log(`2. Sample HTML Sanitization:              ${sampleHtmlSanitizeSuccess ? 'PASS' : 'FAIL'}`);
  log(`3. Built-in HTML Presets Validity:        ${presetsValidSuccess ? 'PASS' : 'FAIL'}`);

  return {
    styleTagBreakoutSuccess,
    sampleHtmlSanitizeSuccess,
    presetsValidSuccess,
    details,
  };
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('verify')) {
  runVerification().catch((err) => {
    console.error('CSS Viewer verification failed:', err);
    process.exit(1);
  });
}
