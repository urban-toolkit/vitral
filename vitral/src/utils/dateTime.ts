/** A `Date` as the local-time string a `<input type="datetime-local">` expects. */
export const toLocalDateTimeInputValue = (date: Date) => {
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};
