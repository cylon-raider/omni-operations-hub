// Date helpers for building calendar weeks/months and formatting date labels.

/** Array of "YYYY-MM-DD" strings for the week containing `dateStr` (Sunday–Saturday). */
export const getWeekDays = (dateStr) => {
  const curr = new Date(dateStr);
  const week = [];

  curr.setDate(curr.getDate() - curr.getDay());

  for (let i = 0; i < 7; i++) {
    week.push(new Date(curr).toISOString().split('T')[0]);
    curr.setDate(curr.getDate() + 1);
  }
  return week;
};

/** Array of "YYYY-MM-DD" strings from the 1st of the month containing `dateStr` up to `dateStr`. */
export const getMonthDays = (dateStr) => {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth();
  const days = [];

  const firstDay = new Date(year, month, 1);
  const targetDate = new Date(dateStr);

  for (let d = new Date(firstDay); d <= targetDate; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d).toISOString().split('T')[0]);
  }
  return days;
};

export const formatDate = (dateStr, options) => {
  return new Date(dateStr).toLocaleDateString('en-US', options || { month: 'numeric', day: 'numeric', year: '2-digit' });
};

export const formatWeekRange = (dateStr) => {
  const week = getWeekDays(dateStr);
  const start = formatDate(week[0]);
  const end = formatDate(week[6]);
  return `${start} - ${end}`;
};
