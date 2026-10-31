const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');

menuToggle.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
});

document.querySelectorAll('.nav-links a').forEach((link) => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation menu');
  });
});

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', link.getAttribute('href'));
    }
  });
});

document.getElementById('year').textContent = new Date().getFullYear();

// The contact form is a local demonstration. It never transmits the email.
const contactForm = document.getElementById('contact-form');
contactForm.addEventListener('submit', (event) => {
  event.preventDefault();
  document.getElementById('form-message').textContent = 'Thanks for your interest! This demo does not send or store your email.';
  contactForm.reset();
});

// Connect the crop form through its tested adapter. Keep the rest of the page usable if it is missing.
const cropForm = document.getElementById('crop-form');
const cropResults = document.getElementById('crop-results');
if (window.AgriCropForm) {
  window.AgriCropForm.connect(cropForm, cropResults);
} else {
  cropForm.addEventListener('submit', (event) => {
    event.preventDefault();
    cropResults.replaceChildren();
    const message = document.createElement('p');
    message.className = 'form-feedback error';
    message.textContent = 'Crop screening could not run. Refresh the page and check that its scripts are available.';
    cropResults.append(message);
  });
}
// Calendar data is stored locally in this browser only.
const calendarDays = document.getElementById('calendar-days');
const calendarMonth = document.getElementById('calendar-month');
const eventList = document.getElementById('event-list');
const eventForm = document.getElementById('event-form');
const calendarFeedback = document.getElementById('calendar-feedback');
const today = new Date();
let shownMonth = new Date(today.getFullYear(), today.getMonth(), 1);
let calendarEvents = [];
try {
  const storedEvents = JSON.parse(localStorage.getItem('agriSmartCalendarEvents') || '[]');
  calendarEvents = Array.isArray(storedEvents) ? storedEvents.filter((item) => item && typeof item.id === 'string' && typeof item.date === 'string' && typeof item.title === 'string') : [];
} catch {
  calendarFeedback.textContent = 'Local reminders could not be loaded. You can still use the calendar for this visit.';
}
function saveCalendarEvents() {
  try {
    localStorage.setItem('agriSmartCalendarEvents', JSON.stringify(calendarEvents));
    return true;
  } catch {
    calendarFeedback.className = 'form-feedback error';
    calendarFeedback.textContent = 'Browser storage is unavailable or full. Your change may not remain after you close this page.';
    return false;
  }
}
function renderCalendar() {
  const year = shownMonth.getFullYear();
  const month = shownMonth.getMonth();
  calendarMonth.textContent = shownMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  calendarDays.replaceChildren();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  for (let index = 0; index < cellCount; index += 1) {
    let dayNumber;
    let cellDate;
    let outside = false;
    if (index < firstWeekday) {
      dayNumber = previousMonthDays - firstWeekday + index + 1;
      cellDate = new Date(year, month - 1, dayNumber);
      outside = true;
    } else if (index >= firstWeekday + daysInMonth) {
      dayNumber = index - firstWeekday - daysInMonth + 1;
      cellDate = new Date(year, month + 1, dayNumber);
      outside = true;
    } else {
      dayNumber = index - firstWeekday + 1;
      cellDate = new Date(year, month, dayNumber);
    }
    const dateKey = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar-day';
    button.textContent = String(dayNumber);
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', `${cellDate.toLocaleDateString(undefined, { dateStyle: 'full' })}${calendarEvents.some((item) => item.date === dateKey) ? ', has reminder' : ''}`);
    if (outside) button.classList.add('outside');
    if (dateKey === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`) button.classList.add('today');
    if (calendarEvents.some((item) => item.date === dateKey)) button.classList.add('has-event');
    button.addEventListener('click', () => {
      eventForm.elements.date.value = dateKey;
      eventForm.elements.title.focus();
      renderEventList();
    });
    calendarDays.append(button);
  }
  renderEventList();
}
function renderEventList() {
  eventList.replaceChildren();
  const currentPrefix = `${shownMonth.getFullYear()}-${String(shownMonth.getMonth() + 1).padStart(2, '0')}-`;
  const visibleEvents = calendarEvents.filter((item) => item.date.startsWith(currentPrefix)).sort((a, b) => a.date.localeCompare(b.date));
  visibleEvents.forEach((item) => {
    const row = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = item.title;
    const date = document.createElement('time');
    date.dateTime = item.date;
    date.textContent = new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'event-remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove reminder: ${item.title}`);
    remove.addEventListener('click', () => {
      calendarEvents = calendarEvents.filter((eventItem) => eventItem.id !== item.id);
      saveCalendarEvents();
      renderCalendar();
    });
    row.append(title, date, remove);
    eventList.append(row);
  });
  if (!visibleEvents.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No reminders for this month yet.';
    eventList.append(empty);
  }
}
document.getElementById('calendar-prev').addEventListener('click', () => {
  shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById('calendar-next').addEventListener('click', () => {
  shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1);
  renderCalendar();
});
eventForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = eventForm.elements.title.value.trim();
  const date = eventForm.elements.date.value;
  if (!title || !date || Number.isNaN(Date.parse(`${date}T00:00:00`))) {
    calendarFeedback.className = 'form-feedback error';
    calendarFeedback.textContent = 'Enter a reminder and choose a valid date.';
    return;
  }
  calendarEvents.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title, date });
  const stored = saveCalendarEvents();
  calendarFeedback.className = stored ? 'form-feedback success' : 'form-feedback error';
  if (stored) calendarFeedback.textContent = 'Reminder added and saved in this browser.';
  shownMonth = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1);
  eventForm.reset();
  renderCalendar();
});
renderCalendar();

// Reveal sections when supported; the page remains visible without this API.
const revealItems = document.querySelectorAll('.service-card, .about-art, .about-copy');
if ('IntersectionObserver' in window) {
  revealItems.forEach((item) => item.classList.add('reveal'));
  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        currentObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealItems.forEach((item) => observer.observe(item));
}

