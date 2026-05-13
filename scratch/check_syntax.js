
import fs from 'fs';

const content = fs.readFileSync('/Users/vinayakkuanr/Documents/Superman_ULTIMATE/src/modules/scheduling/ui/AutoSchedulerModal.tsx', 'utf8');

let braces = 0;
let parens = 0;
let tags = [];

const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '{') braces++;
        if (char === '}') braces--;
        if (char === '(') parens++;
        if (char === ')') parens--;
        
        if (braces < 0 || parens < 0) {
            console.log(`Unbalanced at line ${i + 1}: braces=${braces}, parens=${parens}`);
            process.exit(1);
        }
    }
}

console.log(`Final: braces=${braces}, parens=${parens}`);
