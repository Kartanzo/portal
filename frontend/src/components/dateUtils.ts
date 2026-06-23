export const formatDateBR = (dateString: string | null | undefined): string => {
    if (!dateString) return "-";

    // Ensure we treat the date string as UTC if it's ISO but missing Z
    // Typical backend response: "2026-02-03T11:14:10" (no Z)
    // If we assume this is UTC, we append Z.
    let cleanDate = dateString;
    if (dateString.includes('T') && !dateString.endsWith('Z') && !dateString.includes('+')) {
        cleanDate += 'Z';
    }

    try {
        const date = new Date(cleanDate);
        // Verify valid date
        if (isNaN(date.getTime())) return dateString;

        return date.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch (e) {
        return dateString;
    }
};

/**
 * Parse date string in YYYY-MM-DD format to Date object in LOCAL timezone.
 * Avoids UTC conversion issues that cause off-by-one errors.
 * 
 * Example:
 *   parseDateLocal("2026-01-01") -> Date in local timezone (Jan 1, 2026 00:00:00 LOCAL)
 *   NOT UTC (which would be Dec 31, 2025 21:00:00 in UTC-3)
 */
export function parseDateLocal(dateStr: string | null | undefined): Date | null {
    if (!dateStr) return null;

    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

    // Create Date in LOCAL timezone (month is 0-indexed in JavaScript)
    return new Date(year, month - 1, day);
}

/**
 * Format date string (ISO or YYYY-MM-DD) to DD/MM/YYYY without time.
 * Avoids any timezone conversion.
 */
export function formatDateOnly(dateString: string | null | undefined): string {
    if (!dateString) return "-";

    // Extract YYYY-MM-DD
    const datePart = dateString.split('T')[0];
    const parts = datePart.split('-');

    if (parts.length !== 3) return dateString;

    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
}
