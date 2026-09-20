/** Curated historical records, verified against CAL FIRE on 2026-09-19.
 * These are reported incident milestones, not solver inputs or perimeter observations.
 * Null means the source does not provide a value at that time; never interpolate it.
 */
export type IncidentMilestone = {
  at: string;
  title: string;
  acres: number | null;
  containment: number | null;
  source: string;
};
export type ArchivedIncident = {
  id: string;
  name: string;
  location: string;
  center: [number, number];
  timeZone: string;
  milestones: IncidentMilestone[];
};

const dixie = 'https://www.fire.ca.gov/incidents/2021/7/13/dixie-fire';
const camp = 'https://www.fire.ca.gov/incidents/2018/11/8/camp-fire';

export const archivedIncidents: ArchivedIncident[] = [
  {
    id: 'dixie-2021', name: 'Dixie Fire',
    location: 'Feather River Canyon, California',
    center: [-121.389439, 39.871306], timeZone: 'America/Los_Angeles',
    milestones: [
      {at: '2021-07-13T17:15:00-07:00', title: 'Incident begins', acres: null, containment: null, source: dixie},
      {at: '2021-08-26T07:46:00-07:00', title: 'August situation report', acres: 747091, containment: 45, source: `${dixie}/updates/88a55d33-d721-42e5-addb-31a88c56509d`},
      {at: '2021-09-07T07:45:00-07:00', title: 'September situation report', acres: 917579, containment: 59, source: `${dixie}/updates/35b36b21-80bf-4e0c-9c07-1d8a6d86cd3c`},
      {at: '2021-09-30T07:07:00-07:00', title: 'Containment reaches 94%', acres: 963309, containment: 94, source: `${dixie}/updates/b7d4a9b9-d1bd-4486-8a37-6cc2bd24a308`},
      {at: '2021-10-25T07:45:00-07:00', title: 'Fully contained', acres: 963309, containment: 100, source: dixie},
    ],
  },
  {
    id: 'camp-2018', name: 'Camp Fire',
    location: 'Butte County, California',
    center: [-121.4347, 39.8134], timeZone: 'America/Los_Angeles',
    milestones: [
      {at: '2018-11-08T06:33:00-08:00', title: 'Incident begins', acres: null, containment: null, source: camp},
      {at: '2018-11-25T08:00:00-08:00', title: 'Fully contained', acres: 153336, containment: 100, source: camp},
    ],
  },
];
