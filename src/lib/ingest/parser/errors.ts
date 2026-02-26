export type ParserDiagnosticCode =
  | "invalid_xml"
  | "missing_information_table"
  | "missing_required_node"
  | "invalid_numeric_value";

export interface ParserDiagnostic {
  code: ParserDiagnosticCode;
  message: string;
  accessionNumber?: string;
  rowNumber?: number;
  nodeName?: string;
}

export class FilingParserError extends Error {
  public readonly diagnostic: ParserDiagnostic;

  constructor(diagnostic: ParserDiagnostic) {
    super(diagnostic.message);
    this.name = "FilingParserError";
    this.diagnostic = diagnostic;
  }
}
