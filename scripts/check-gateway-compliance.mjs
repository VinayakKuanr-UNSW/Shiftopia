import fs from 'fs';
import path from 'path';

/**
 * CI / Static Analysis Linter for Concurrency Gateway Compliance.
 * Verifies that no React frontend code executes direct `supabase.from('shifts').update(...)`
 * bypassing the sm_apply_shift_op gateway.
 */

const srcDir = './src';
let violations = 0;

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (line.includes(".from('shifts').update(") || line.includes('.from("shifts").update(')) {
          // Allow authorized gateway wrappers in shifts.api.ts and shifts.commands.ts
          if (!fullPath.includes('shifts.api.ts') && !fullPath.includes('shifts.commands.ts')) {
            console.error(`[GATEWAY LINT ERROR] Direct shift table update detected at ${fullPath}:${index + 1}`);
            violations++;
          }
        }
      });
    }
  }
}

scanDir(srcDir);

if (violations > 0) {
  console.error(`Found ${violations} gateway compliance violation(s). Shift mutations must use sm_apply_shift_op.`);
  process.exit(1);
} else {
  console.log('✔ Gateway compliance check passed: zero unauthorized direct shift table updates in frontend source.');
}
