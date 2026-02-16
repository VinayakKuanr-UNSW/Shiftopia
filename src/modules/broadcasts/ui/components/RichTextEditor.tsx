import React, { useRef } from 'react';
import { Bold, Italic, Underline, Strikethrough } from 'lucide-react';
import DOMPurify from 'dompurify';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';

interface RichTextEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
    value,
    onChange,
    placeholder,
}) => {
    const editorRef = useRef<HTMLDivElement>(null);

    const execCommand = (command: string) => {
        document.execCommand(command, false);
        editorRef.current?.focus();
        if (editorRef.current) {
            onChange(editorRef.current.innerHTML);
        }
    };

    const handleInput = () => {
        if (editorRef.current) {
            onChange(editorRef.current.innerHTML);
        }
    };

    return (
        <div className="border border-border rounded-xl overflow-hidden bg-muted/50">
            <div className="flex items-center gap-1 p-2 border-b border-border bg-muted/30">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => execCommand('bold')}
                            >
                                <Bold className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Bold</TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => execCommand('italic')}
                            >
                                <Italic className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Italic</TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => execCommand('underline')}
                            >
                                <Underline className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Underline</TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => execCommand('strikeThrough')}
                            >
                                <Strikethrough className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Strikethrough</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            <div
                ref={editorRef}
                contentEditable
                className="min-h-[120px] p-4 text-foreground focus:outline-none"
                onInput={handleInput}
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }}
                data-placeholder={placeholder}
                style={{ minHeight: '120px' }}
            />
            <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground));
          pointer-events: none;
        }
      `}</style>
        </div>
    );
};
