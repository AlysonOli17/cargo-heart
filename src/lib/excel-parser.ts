import * as XLSX from "xlsx";

export type ParsedScheduleRow = {
  equipment_identifier: string;
  plate: string | null;
  model: string | null;
  client: string;
  turno: string | null;
  schedule_start: string | null;
  schedule_end: string | null;
  cost_center: string | null;
  location: string | null;
  activity: string | null;
  operator_name: string | null;
  work_order: string | null;
  contract_type: "Habitual" | "Eventual";
  shift: "Dia" | "Noite";
  team: string | null;
};

export type ParsedDay = {
  date: string; // "YYYY-MM-DD"
  sheetName: string;
  groups: Array<{
    label: string; // "Programação Habitual - Dia - 27/07/2026 - Equipe Usina 5/7"
    contract_type: "Habitual" | "Eventual";
    shift: "Dia" | "Noite";
    team: string | null;
    rows: ParsedScheduleRow[];
  }>;
};

const HEADER_COLS = ["Equipamento", "Placa", "MODELO", "cliente", "TURNO"];

function parseHorario(raw: string | null): { start: string | null; end: string | null } {
  if (!raw) return { start: null, end: null };
  const str = String(raw).toUpperCase().replace(/\s+/g, "");
  // Patterns: "07:30X15:30", "07:30x17:30", "19X05:30", "16x23:00"
  const match = str.match(/(\d{1,2}(?::\d{2})?)[Xx](\d{1,2}(?::\d{2})?)/);
  if (!match) return { start: null, end: null };
  const normalize = (t: string) => {
    if (t.includes(":")) return t.padStart(5, "0");
    return `${t.padStart(2, "0")}:00`;
  };
  return { start: normalize(match[1]), end: normalize(match[2]) };
}

function parseGroupHeader(cellValue: string): {
  contract_type: "Habitual" | "Eventual";
  shift: "Dia" | "Noite";
  team: string | null;
} | null {
  const v = String(cellValue || "").toLowerCase();
  if (!v.includes("programação") && !v.includes("programacao")) return null;

  const isEventual = v.includes("eventual");
  const isNoite = v.includes("noite");

  // Extract team: "Equipe Usina 5/7"
  const teamMatch = String(cellValue).match(/Equipe\s+(.+?)(?:\s*$)/i);
  const team = teamMatch ? teamMatch[1].trim() : null;

  return {
    contract_type: isEventual ? "Eventual" : "Habitual",
    shift: isNoite ? "Noite" : "Dia",
    team,
  };
}

function isHeaderRow(row: unknown[]): boolean {
  if (!Array.isArray(row)) return false;
  const vals = row.map((v) => String(v || "").toLowerCase());
  return vals.some((v) => v === "equipamento") && vals.some((v) => v === "placa");
}

function excelSerialToDate(serial: number): string {
  // Excel date serial: days since 1900-01-01 (with leap year bug)
  const d = new Date((serial - 25569) * 86400 * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sheetNameToDate(name: string): string | null {
  // "SEGUNDA 27 07 LETRA B" -> "2026-07-27"
  const m = name.match(/(\d{2})\s+(\d{2})\s+(?:LETRA|$)/i);
  if (!m) return null;
  const day = m[1];
  const month = m[2];
  const now = new Date();
  // Assume current year; if month < current month it could be next year, but safe to use current year
  const year = now.getFullYear();
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function parseExcelFile(buffer: ArrayBuffer, filename: string): ParsedDay[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const results: ParsedDay[] = [];

  // Days are each sheet (except "OS APROVAÇÃO" and "NA")
  const skipSheets = ["os aprovação", "na", "os aprovacao"];

  for (const sheetName of wb.SheetNames) {
    if (skipSheets.includes(sheetName.trim().toLowerCase())) continue;

    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      blankrows: true,
    });

    const dateStr = sheetNameToDate(sheetName) || new Date().toISOString().slice(0, 10);
    const parsedDay: ParsedDay = {
      date: dateStr,
      sheetName: sheetName.trim(),
      groups: [],
    };

    let currentGroup: ParsedDay["groups"][number] | null = null;
    let skipNextRow = false; // skip the column header row after group header

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as unknown[];

      // Check if this row is a group header
      const firstCell = String(row[0] || "");
      const groupInfo = parseGroupHeader(firstCell);

      if (groupInfo) {
        currentGroup = {
          label: firstCell.trim(),
          ...groupInfo,
          rows: [],
        };
        parsedDay.groups.push(currentGroup);
        skipNextRow = true; // next row is the column headers row
        continue;
      }

      if (skipNextRow && isHeaderRow(row)) {
        skipNextRow = false;
        continue;
      }
      skipNextRow = false;

      if (!currentGroup) continue;

      // Check if row has equipment data
      const equipCell = String(row[0] || "").trim();
      const plateCell = String(row[1] || "").trim();

      // Skip empty rows or sub-header rows
      if (!equipCell || equipCell.toLowerCase() === "equipamento") continue;

      // Skip if it looks like another group header
      if (parseGroupHeader(equipCell)) {
        currentGroup = {
          label: equipCell.trim(),
          ...parseGroupHeader(equipCell)!,
          rows: [],
        };
        parsedDay.groups.push(currentGroup);
        skipNextRow = true;
        continue;
      }

      const horarioRaw = String(row[5] || "");
      const { start, end } = parseHorario(horarioRaw);

      const schedRow: ParsedScheduleRow = {
        equipment_identifier: equipCell,
        plate: plateCell || null,
        model: row[2] ? String(row[2]).trim() : null,
        client: String(row[3] || "USINA").trim(),
        turno: row[4] ? String(row[4]).trim() : null,
        schedule_start: start,
        schedule_end: end,
        cost_center: row[6] ? String(row[6]).trim() : null,
        location: null,
        activity: null,
        operator_name: null,
        work_order: null,
        contract_type: currentGroup.contract_type,
        shift: currentGroup.shift,
        team: currentGroup.team,
      };

      // Column layout differs by contract type:
      // Habitual Dia: [equip, plate, model, client, turno, horario, cc, TABLET, LOCAL, ACTIVITY, OPERATOR, OS]
      // Eventual Dia:  [equip, plate, model, client, turno, horario, cc, LOCAL,  ACTIVITY, OPERATOR, OS]
      // Noite blocks:  [equip, plate, model, client, turno, horario, cc, LOCAL,  ACTIVITY, OPERATOR, OS]
      if (currentGroup.contract_type === "Habitual" && currentGroup.shift === "Dia") {
        // Habitual Dia has an extra "Tablet" column at col7, shifting everything right by 1
        schedRow.location = row[8] ? String(row[8]).trim() : null;
        schedRow.activity = row[9] ? String(row[9]).trim() : null;
        schedRow.operator_name = row[10] ? String(row[10]).trim() : null;
        schedRow.work_order = row[11] ? String(row[11]).trim() : null;
      } else {
        // Eventual (Dia or Noite) and Habitual Noite: no Tablet column
        schedRow.location = row[7] ? String(row[7]).trim() : null;
        schedRow.activity = row[8] ? String(row[8]).trim() : null;
        schedRow.operator_name = row[9] ? String(row[9]).trim() : null;
        schedRow.work_order = row[10] ? String(row[10]).trim() : null;
      }

      currentGroup.rows.push(schedRow);
    }

    // Only add day if it has groups with rows
    if (parsedDay.groups.some((g) => g.rows.length > 0)) {
      results.push(parsedDay);
    }
  }

  return results;
}
