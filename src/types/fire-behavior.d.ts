declare module '@cbevins/fire-behavior-simulator' {
  interface Dag {
    configure(values: [string, string][]): Dag;
    select(keys: string[]): Dag;
    input(values: [string, (number | string)[]][]): Dag;
    run(): unknown;
    node(key: string): {value(): number};
  }
  export class Sim { createDag(name: string): Dag; }
}
