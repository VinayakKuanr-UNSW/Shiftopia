
import fs from 'fs';

const content = fs.readFileSync('/Users/vinayakkuanr/Documents/Superman_ULTIMATE/src/modules/scheduling/ui/AutoSchedulerModal.tsx', 'utf8');

const stack = [];
// Updated regex to handle multiline tags
const tagRegex = /<(\/?[a-zA-Z0-9.]+)([\s\S]*?)>/g;
let match;

while ((match = tagRegex.exec(content)) !== null) {
    const tagName = match[1];
    const tagBody = match[2];
    
    if (tagBody.trim().endsWith('/')) {
        // Self-closing
    } else if (tagName.startsWith('/')) {
        const closing = tagName.substring(1);
        const opening = stack.pop();
        if (opening !== closing) {
            const index = match.index;
            const line = content.substring(0, index).split('\n').length;
            console.log(`Mismatch at line ${line}: expected </${opening}>, got </${closing}>`);
            process.exit(1);
        }
    } else {
        stack.push(tagName);
    }
}

if (stack.length > 0) {
    console.log(`Remaining in stack: ${stack.join(', ')}`);
} else {
    console.log("All tags balanced!");
}
