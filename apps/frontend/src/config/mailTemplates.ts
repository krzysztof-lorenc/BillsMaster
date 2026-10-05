import type { MailScriptTemplate } from '@bills-master/shared-types';

export const MAIL_SCRIPT_TEMPLATES: MailScriptTemplate[] = [
  {
    id: 'orange',
    name: 'Orange',
    displayName: 'Orange',
    category: 'TELECOM',
    senderFilter: 'e\\-faktura\\@pl\\.orange\\.com',
    titleFilter: 'e\\-faktura Orange',
    description: 'Faktury Orange (telefon, internet, światłowód)',
  },
  {
    id: 'play',
    name: 'Play',
    displayName: 'Play',
    category: 'TELECOM',
    senderFilter: 'awizo\\@mojefinanseplay\\.pl',
    titleFilter: 'Play.*(faktura|rachunek).*|.*faktura.*',
    description: 'Powiadomienia i faktury Play',
  },
  {
    id: 'canalplus',
    name: 'Canal Plus',
    displayName: 'Canal+',
    category: 'OTHER',
    senderFilter: 'e\\-rachunek\\@platnosci\\.canalplus\\.pl',
    titleFilter: '.*CANAL\\+.*|.*e-rachunek.*|.*faktura.*',
    description: 'e-rachunki i rozliczenia CANAL+',
  },
];
