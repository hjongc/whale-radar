import type { InstitutionUniverseRecord } from "@/lib/domain/contracts";

export interface InstitutionUpsertResult {
  upsertedCount: number;
  totalKnownInstitutions: number;
}

export interface InstitutionDbClient {
  upsertInstitutions(records: InstitutionUniverseRecord[]): Promise<InstitutionUpsertResult>;
}

export class InstitutionRepository {
  constructor(private readonly dbClient: InstitutionDbClient) {}

  async upsertUniverse(records: InstitutionUniverseRecord[]): Promise<InstitutionUpsertResult> {
    const deduped = new Map<string, InstitutionUniverseRecord>();
    for (const record of records) {
      deduped.set(record.cik, record);
    }

    return this.dbClient.upsertInstitutions([...deduped.values()]);
  }
}

export class InMemoryInstitutionDbClient implements InstitutionDbClient {
  private readonly rows = new Map<string, InstitutionUniverseRecord>();

  async upsertInstitutions(records: InstitutionUniverseRecord[]): Promise<InstitutionUpsertResult> {
    for (const record of records) {
      this.rows.set(record.cik, record);
    }

    return {
      upsertedCount: records.length,
      totalKnownInstitutions: this.rows.size
    };
  }

  list(): InstitutionUniverseRecord[] {
    return [...this.rows.values()].sort((a, b) => a.cik.localeCompare(b.cik));
  }
}
