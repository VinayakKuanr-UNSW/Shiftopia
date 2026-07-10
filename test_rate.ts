import { getGrossPayInputsForPeriod } from './src/modules/payroll/data/grossPay.read.api';

async function main() {
  const bounds = {
    periodStart: '2026-07-06',
    periodEnd: '2026-07-12',
  };
  const inputs = await getGrossPayInputsForPeriod(bounds, { approvedOnly: false });
  
  const mSmith = inputs.filter(i => i.employeeId === 'a912894a-b1c4-4478-ae4d-72815dda70f2');
  const kVinayak = inputs.filter(i => i.employeeId === 'dddc2d5a-d64a-4e38-bf2e-9ca97cfe2afd');

  console.log('Michael Smith Inputs:', JSON.stringify(mSmith, null, 2));
  console.log('Kuanr Vinayak Inputs:', JSON.stringify(kVinayak, null, 2));
}

main().catch(console.error);
