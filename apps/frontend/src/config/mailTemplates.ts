import type { MailScriptTemplate } from '@bills-master/shared-types';

export const MAIL_SCRIPT_TEMPLATES: MailScriptTemplate[] = [
  {
    id: 'wspolnota-miarki-5',
    name: 'Wspólnota Mieszkaniowa Miarki 5',
    displayName: 'Wspólnota Mieszkaniowa (Miarki 5)',
    category: 'HOUSING',
    senderFilter: 'nieruchomosci\\@adres\\.pl',
    titleFilter: '.*noty\\s+obci[aą][zż]eniowe.*Miarki.*',
    paymentReceiver: 'Wspólnota Mieszkaniowa ul. Miarki 5',
    description: 'Noty obciążeniowe i rozliczenia Wspólnoty Mieszkaniowej Miarki 5',
  },
  {
    id: 'orange',
    name: 'Orange',
    displayName: 'Orange',
    category: 'TELECOM',
    senderFilter: 'e\\-faktura\\@pl\\.orange\\.com',
    titleFilter: 'e\\-faktura Orange',
    paymentReceiver: 'Orange Polska S.A.',
    description: 'Faktury Orange (telefon, internet, światłowód)',
  },
  {
    id: 'play',
    name: 'Play',
    displayName: 'Play',
    category: 'TELECOM',
    senderFilter: 'awizo\\@mojefinanseplay\\.pl',
    titleFilter: 'Play.*(faktura|rachunek).*|.*faktura.*',
    paymentReceiver: 'P4 Sp. z o.o.',
    description: 'Powiadomienia i faktury Play',
  },
  {
    id: 'canalplus',
    name: 'Canal Plus',
    displayName: 'Canal+',
    category: 'OTHER',
    senderFilter: 'e\\-rachunek\\@platnosci\\.canalplus\\.pl',
    titleFilter: '.*CANAL\\+.*|.*e-rachunek.*|.*faktura.*',
    paymentReceiver: 'CANAL+ Polska S.A.',
    description: 'e-rachunki i rozliczenia CANAL+',
  },
];
