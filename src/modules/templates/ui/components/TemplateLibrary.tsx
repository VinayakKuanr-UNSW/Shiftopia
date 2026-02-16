import React, { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { PlusIcon, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Template } from '@/types';
import { useDrag, useDrop } from 'react-dnd';

export interface TemplateSummary {
  id: number | string;
  name: string;
  updatedAt: string; // ISO string
  status: 'published' | 'draft';
}

interface TemplateLibraryProps {
  templates: TemplateSummary[];
  currentId: number | string | null;
  onSelect: (id: number | string) => void;
  onNew: () => void;
}

const TemplateLibrary: React.FC<TemplateLibraryProps> = ({
  templates,
  currentId,
  onSelect,
  onNew,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [publishedExpanded, setPublishedExpanded] = useState(true);
  const [draftExpanded, setDraftExpanded] = useState(true);

  // Simulate loading state
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Filter templates by status
  const publishedTemplates = templates.filter(t => t.status === 'published');
  const draftTemplates = templates.filter(t => t.status === 'draft');

  return (
    <aside className="w-64 bg-card/80 border-r border-border flex-shrink-0 flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-lg font-semibold">Templates</h2>
        <Button
          size="icon"
          variant="ghost"
          onClick={onNew}
          className="hover:bg-muted/50 transition-colors"
          aria-label="New Template"
        >
          <PlusIcon className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-5 w-3/4 mt-6" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="p-4">
            {/* Published Templates Section */}
            <div className="mb-4">
              <button 
                className="flex items-center justify-between w-full text-left mb-2 text-sm font-medium"
                onClick={() => setPublishedExpanded(!publishedExpanded)}
                aria-expanded={publishedExpanded}
              >
                <span>Published Templates</span>
                {publishedExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              
              {publishedExpanded && (
                <div className="space-y-1">
                  {publishedTemplates.length > 0 ? (
                    publishedTemplates.map((tpl) => (
                      <button
                        key={tpl.id}
                        onClick={() => onSelect(tpl.id)}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-md flex flex-col hover:bg-muted/50 transition-colors',
                          tpl.id === currentId ? 'bg-primary/20' : ''
                        )}
                      >
                        <span className="font-medium truncate">{tpl.name}</span>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(tpl.updatedAt), 'MMM d, yyyy')}
                          </span>
                          <Badge variant="outline" className="text-xs">Published</Badge>
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground px-3 py-2">No published templates</p>
                  )}
                </div>
              )}
            </div>

            {/* Draft Templates Section */}
            <div>
              <button 
                className="flex items-center justify-between w-full text-left mb-2 text-sm font-medium"
                onClick={() => setDraftExpanded(!draftExpanded)}
                aria-expanded={draftExpanded}
              >
                <span>Draft Templates</span>
                {draftExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              
              {draftExpanded && (
                <div className="space-y-1">
                  {draftTemplates.length > 0 ? (
                    draftTemplates.map((tpl) => (
                      <button
                        key={tpl.id}
                        onClick={() => onSelect(tpl.id)}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-md flex flex-col hover:bg-muted/50 transition-colors',
                          tpl.id === currentId ? 'bg-primary/20' : ''
                        )}
                      >
                        <span className="font-medium truncate">{tpl.name}</span>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(tpl.updatedAt), 'MMM d, yyyy')}
                          </span>
                          <Badge variant="secondary" className="text-xs">Draft</Badge>
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground px-3 py-2">No draft templates</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </ScrollArea>
    </aside>
  );
};

export default TemplateLibrary;
