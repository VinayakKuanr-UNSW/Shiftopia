/**
 * DraftEditor — the Rate Card Studio for one draft: details, base rates,
 * allowances, loadings, apprentices and trainees, and a shift cost sandbox.
 * Every change is saved to the draft at once (it prices nothing until it is
 * published); Review, alongside, shows the result against its source.
 */

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import type { RateCard } from '../../../../data/rateCards.api';
import AllowancesTab from './AllowancesTab';
import CostSandbox from './CostSandbox';
import DetailsTab from './DetailsTab';
import LoadingsTab from './LoadingsTab';
import RatesTab from './RatesTab';
import TraineeTab from './TraineeTab';

const TABS = [
  ['details', 'Details'], ['rates', 'Base rates'], ['allowances', 'Allowances'],
  ['loadings', 'Loadings & rules'], ['trainees', 'Apprentices & trainees'], ['sandbox', 'Cost sandbox'],
] as const;

const DraftEditor: React.FC<{ card: RateCard; cards: RateCard[] }> = ({ card, cards }) => (
  <div className="mt-4 border-t border-border/40 pt-4" role="region" aria-label={'Edit draft ' + card.code}>
    <Tabs defaultValue="rates">
      <TabsList className="flex flex-wrap h-auto">
        {TABS.map(([v, l]) => <TabsTrigger key={v} value={v} className="text-[13px]">{l}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="details" className="mt-4"><DetailsTab card={card} /></TabsContent>
      <TabsContent value="rates" className="mt-4"><RatesTab card={card} cards={cards} /></TabsContent>
      <TabsContent value="allowances" className="mt-4"><AllowancesTab card={card} /></TabsContent>
      <TabsContent value="loadings" className="mt-4"><LoadingsTab card={card} /></TabsContent>
      <TabsContent value="trainees" className="mt-4"><TraineeTab card={card} cards={cards} /></TabsContent>
      <TabsContent value="sandbox" className="mt-4"><CostSandbox card={card} cards={cards} /></TabsContent>
    </Tabs>
  </div>
);

export default DraftEditor;
