import React from 'react';
import { Radio, MessageSquare, Hash } from 'lucide-react';

export const EmptyGroups: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-[50vh] md:h-[60vh] p-6 md:p-8 text-center">
    <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-4 md:mb-6 border border-slate-200 dark:border-white/10 shadow-2xl relative">
      <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
      <Radio className="h-10 w-10 md:h-12 md:w-12 text-slate-400 dark:text-blue-200/60 relative z-10" />
    </div>
    <h3 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white mb-2">No Broadcast Groups</h3>
    <p className="text-slate-500 dark:text-blue-200/60 max-w-sm leading-relaxed text-sm md:text-base">
      You haven't been added to any broadcast groups yet. Contact your manager if you believe this is an error.
    </p>
  </div>
);

export const EmptyMessages: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-6 md:p-8 text-center min-h-[300px] md:min-h-[400px]">
    <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-4 md:mb-6 border border-slate-200 dark:border-white/10">
      <MessageSquare className="h-8 w-8 md:h-10 md:w-10 text-slate-300 dark:text-white/20" />
    </div>
    <h3 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white mb-2">No Messages</h3>
    <p className="text-slate-400 dark:text-blue-200/40 max-w-xs mx-auto text-sm">
      No broadcasts have been sent to this channel yet.
    </p>
  </div>
);

export const EmptyChannels: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-6 md:p-8 text-center">
    <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-4 md:mb-5 border border-slate-200 dark:border-white/10">
      <Hash className="h-6 w-6 md:h-8 md:w-8 text-slate-300 dark:text-white/20" />
    </div>
    <h3 className="text-base md:text-lg font-bold text-slate-900 dark:text-white mb-2">No Channels</h3>
    <p className="text-slate-400 dark:text-blue-200/40 text-sm">This group doesn't have any channels configured.</p>
  </div>
);
