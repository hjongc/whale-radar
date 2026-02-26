import type { FilingArtifact } from "@/lib/domain/contracts";

export interface FilingUpsertResult {
  created: boolean;
  totalKnownFilings: number;
  record: FilingArtifact;
}

export interface FilingDbClient {
  getFilingByAccession(accessionNumber: string): Promise<FilingArtifact | null>;
  insertFiling(record: FilingArtifact): Promise<void>;
  countFilings(): Promise<number>;
}

export class FilingRepository {
  constructor(private readonly dbClient: FilingDbClient) {}

  async countKnownFilings(): Promise<number> {
    return this.dbClient.countFilings();
  }

  async upsertByAccession(record: FilingArtifact): Promise<FilingUpsertResult> {
    const existing = await this.dbClient.getFilingByAccession(record.accessionNumber);
    if (existing) {
      return {
        created: false,
        totalKnownFilings: await this.countKnownFilings(),
        record: existing
      };
    }

    await this.dbClient.insertFiling(record);

    return {
      created: true,
      totalKnownFilings: await this.countKnownFilings(),
      record
    };
  }
}

export class InMemoryFilingDbClient implements FilingDbClient {
  private readonly rows = new Map<string, FilingArtifact>();

  async getFilingByAccession(accessionNumber: string): Promise<FilingArtifact | null> {
    return this.rows.get(accessionNumber) ?? null;
  }

  async insertFiling(record: FilingArtifact): Promise<void> {
    this.rows.set(record.accessionNumber, record);
  }

  async countFilings(): Promise<number> {
    return this.rows.size;
  }

  list(): FilingArtifact[] {
    return [...this.rows.values()].sort((a, b) => a.accessionNumber.localeCompare(b.accessionNumber));
  }
}
