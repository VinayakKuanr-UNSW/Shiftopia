
import fs from 'fs';

const content = fs.readFileSync('/Users/vinayakkuanr/Documents/Superman_ULTIMATE/src/modules/scheduling/ui/AutoSchedulerModal.tsx', 'utf8');

const tags = ['div', 'motion.div', 'AnimatePresence', 'ScrollArea', 'Badge', 'Button', 'Label', 'Input', 'Tooltip', 'TooltipTrigger', 'TooltipContent', 'Popover', 'PopoverTrigger', 'PopoverContent'];
const stack = [];

// Very simple tag parser
let i = 0;
while (i < content.length) {
    if (content[i] === '<') {
        let j = i + 1;
        while (j < content.length && content[j] !== '>') j++;
        const fullTag = content.substring(i, j + 1);
        
        if (fullTag.startsWith('<!--')) {
            // comment
        } else if (fullTag.startsWith('</')) {
            const tagName = fullTag.substring(2, fullTag.length - 1).trim().split(' ')[0];
            const opening = stack.pop();
            if (opening !== tagName) {
                const line = content.substring(0, i).split('\n').length;
                console.log(`Mismatch at line ${line}: expected </${opening}>, got </${tagName}>`);
            }
        } else {
            const tagName = fullTag.substring(1, fullTag.length - 1).trim().split(' ')[0];
            if (tagName && !tagName.startsWith('!') && !fullTag.endsWith('/>')) {
                // Heuristic: check if this tag is typically self-closing in this codebase
                if (['Input', 'img', 'br', 'hr', 'Plus', 'Check', 'Loader2', 'AlertTriangle', 'CheckCircle2', 'Cpu', 'Download', 'LayoutGrid', 'List', 'ChevronUp', 'ChevronDown', 'ArrowUpDown', 'WifiOff'].includes(tagName)) {
                    // self-closing
                } else {
                    stack.push(tagName);
                }
            }
        }
        i = j;
    }
    i++;
}

console.log(`Stack at end: ${stack.join(', ')}`);
