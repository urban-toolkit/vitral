export const fromDate = (d: Date | string) => (d instanceof Date ? d.toString() : d);

export const toLocalDateTimeInputValue = (date: Date) => {
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};
