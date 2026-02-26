import type { FilingAction, FilingFormType } from "@/lib/domain/enums";
import type { FilingArtifact, FilingPosition } from "@/lib/domain/contracts";
import { parseFilingPosition } from "@/lib/domain/validation";
import { FilingParserError } from "@/lib/ingest/parser/errors";

export type ParsedFilingStatus = "holdings" | "notice_only";

export interface NormalizedHoldingRecord extends FilingPosition {
  ticker?: string;
  type: FilingAction;
  weight?: string;
  cost?: number;
  price?: number;
  gap?: string;
}

export interface ParsedInformationTableResult {
  accessionNumber: string;
  institutionCik: string;
  reportPeriod: string;
  filingDate: string;
  filingFormType: FilingFormType;
  isAmendment: boolean;
  amendsAccessionNumber?: string;
  status: ParsedFilingStatus;
  holdings: NormalizedHoldingRecord[];
}

function isNoticeForm(formType: FilingFormType): boolean {
  return formType === "13F-NT" || formType === "13F-NT/A";
}

function stripNamespace(tagName: string): string {
  return tagName.includes(":") ? tagName.split(":").at(-1) ?? tagName : tagName;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function assertWellFormedXml(xml: string, accessionNumber: string): void {
  const stack: string[] = [];
  const tagPattern = /<([^<>]+)>/g;
  let match = tagPattern.exec(xml);

  while (match) {
    const tag = match[1]?.trim() ?? "";

    if (!tag || tag.startsWith("?") || tag.startsWith("!") || tag.endsWith("?")) {
      match = tagPattern.exec(xml);
      continue;
    }

    const isClosing = tag.startsWith("/");
    const isSelfClosing = tag.endsWith("/");
    const normalized = stripNamespace((isClosing ? tag.slice(1) : tag).split(/\s+/)[0] ?? "");

    if (!normalized) {
      throw new FilingParserError({
        code: "invalid_xml",
        accessionNumber,
        message: `Invalid XML tag token detected for accession ${accessionNumber}.`
      });
    }

    if (isClosing) {
      const expected = stack.pop();
      if (expected !== normalized) {
        throw new FilingParserError({
          code: "invalid_xml",
          accessionNumber,
          message: `Malformed XML for accession ${accessionNumber}; expected closing tag for <${expected}> but received </${normalized}>.`
        });
      }
    } else if (!isSelfClosing) {
      stack.push(normalized);
    }

    match = tagPattern.exec(xml);
  }

  if (stack.length > 0) {
    throw new FilingParserError({
      code: "invalid_xml",
      accessionNumber,
      message: `Malformed XML for accession ${accessionNumber}; unclosed tags remain: ${stack.join(", ")}.`
    });
  }
}

function extractTag(xml: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`, "i");
  const match = pattern.exec(xml);
  return match?.[1] ? decodeXmlText(match[1]) : undefined;
}

function extractRequiredTag(xml: string, tagName: string, accessionNumber: string, rowNumber: number): string {
  const value = extractTag(xml, tagName);
  if (!value) {
    throw new FilingParserError({
      code: "missing_required_node",
      accessionNumber,
      rowNumber,
      nodeName: tagName,
      message: `Missing required XML node <${tagName}> for accession ${accessionNumber} row ${rowNumber}.`
    });
  }

  return value;
}

function parseNumberNode(
  raw: string,
  accessionNumber: string,
  rowNumber: number,
  nodeName: string
): number {
  const parsed = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new FilingParserError({
      code: "invalid_numeric_value",
      accessionNumber,
      rowNumber,
      nodeName,
      message: `Invalid numeric value in <${nodeName}> for accession ${accessionNumber} row ${rowNumber}.`
    });
  }

  return parsed;
}

function extractInfoTableRows(xml: string): string[] {
  const rows: string[] = [];
  const rowPattern = /<(?:\w+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  let match = rowPattern.exec(xml);

  while (match) {
    rows.push(match[1] ?? "");
    match = rowPattern.exec(xml);
  }

  return rows;
}

function parseHoldingRow(rowXml: string, accessionNumber: string, rowNumber: number): NormalizedHoldingRecord {
  const issuerName = extractRequiredTag(rowXml, "nameOfIssuer", accessionNumber, rowNumber);
  const classTitle = extractTag(rowXml, "titleOfClass");
  const cusip = extractRequiredTag(rowXml, "cusip", accessionNumber, rowNumber).toUpperCase();
  const valueUsdThousands = parseNumberNode(
    extractRequiredTag(rowXml, "value", accessionNumber, rowNumber),
    accessionNumber,
    rowNumber,
    "value"
  );

  const sharesContainer = extractTag(rowXml, "shrsOrPrnAmt") ?? rowXml;
  const shares = parseNumberNode(
    extractRequiredTag(sharesContainer, "sshPrnamt", accessionNumber, rowNumber),
    accessionNumber,
    rowNumber,
    "sshPrnamt"
  );
  const ticker = extractTag(rowXml, "symbol")?.toUpperCase();

  const parsedPosition = parseFilingPosition({
    rowNumber,
    issuerName,
    classTitle,
    cusip,
    ticker,
    valueUsdThousands,
    shares,
    action: "KEEP"
  });

  return {
    ...parsedPosition,
    ticker,
    type: "KEEP",
    weight: undefined,
    cost: undefined,
    price: undefined,
    gap: undefined
  };
}

export function parseInformationTableXml(
  artifact: FilingArtifact,
  informationTableXml: string | undefined
): ParsedInformationTableResult {
  if (isNoticeForm(artifact.filingFormType)) {
    return {
      accessionNumber: artifact.accessionNumber,
      institutionCik: artifact.institutionCik,
      reportPeriod: artifact.reportPeriod,
      filingDate: artifact.filingDate,
      filingFormType: artifact.filingFormType,
      isAmendment: artifact.isAmendment,
      amendsAccessionNumber: artifact.amendsAccessionNumber,
      status: "notice_only",
      holdings: []
    };
  }

  if (!informationTableXml || informationTableXml.trim().length === 0) {
    throw new FilingParserError({
      code: "missing_information_table",
      accessionNumber: artifact.accessionNumber,
      message: `Information table XML is required for accession ${artifact.accessionNumber}.`
    });
  }

  assertWellFormedXml(informationTableXml, artifact.accessionNumber);

  const rows = extractInfoTableRows(informationTableXml);
  if (rows.length === 0) {
    throw new FilingParserError({
      code: "missing_information_table",
      accessionNumber: artifact.accessionNumber,
      message: `No <infoTable> rows found in information table XML for accession ${artifact.accessionNumber}.`
    });
  }

  return {
    accessionNumber: artifact.accessionNumber,
    institutionCik: artifact.institutionCik,
    reportPeriod: artifact.reportPeriod,
    filingDate: artifact.filingDate,
    filingFormType: artifact.filingFormType,
    isAmendment: artifact.isAmendment,
    amendsAccessionNumber: artifact.amendsAccessionNumber,
    status: "holdings",
    holdings: rows.map((rowXml, index) => parseHoldingRow(rowXml, artifact.accessionNumber, index + 1))
  };
}
