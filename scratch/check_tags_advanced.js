
import fs from 'fs';

const content = fs.readFileSync('/Users/vinayakkuanr/Documents/Superman_ULTIMATE/src/modules/scheduling/ui/AutoSchedulerModal.tsx', 'utf8');

const stack = [];
const tagRegex = /<(\/?[a-zA-Z0-9.]+)([\s\S]*?)>/g;
let match;

while ((match = tagRegex.exec(content)) !== null) {
    const tagName = match[1];
    const tagBody = match[2];
    const fullTag = match[0];
    
    if (tagBody.trim().endsWith('/') || fullTag.endsWith('/>')) {
        // Self-closing
    } else if (tagName.startsWith('/')) {
        const closing = tagName.substring(1);
        const opening = stack.pop();
        if (opening !== closing) {
            const index = match.index;
            const line = content.substring(0, index).split('\n').length;
            console.log(`Mismatch at line ${line}: expected </${opening}>, got </${closing}>`);
            // Show some context
            console.log("Context: " + content.substring(index - 50, index + 50).replace(/\n/g, ' '));
            process.exit(1);
        }
    } else {
        // Skip common self-closing components that might not use />
        if (['Input', 'img', 'br', 'hr', 'Plus', 'Check', 'Loader2', 'AlertTriangle', 'CheckCircle2', 'Cpu', 'Download', 'LayoutGrid', 'List', 'ChevronUp', 'ChevronDown', 'ArrowUpDown', 'WifiOff', 'Badge', 'AlertCircle', 'ShieldCheck', 'Users', 'Settings', 'Zap', 'BarChart3', 'Save', 'Play', 'RotateCcw', 'Trash2', 'MoreHorizontal', 'Shield'].includes(tagName)) {
             // Assume self-closing if it's one of these and doesn't have a matching close later
             // Actually, for this script, let's just stick to the ones we know ARE NOT containers.
             // But Badge CAN be a container.
        }
        stack.push(tagName);
    }
}

console.log("Balanced!");
