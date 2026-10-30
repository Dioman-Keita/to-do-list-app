// Icônes "griffonnées" au stylo pour les onglets.
const Doodle = ({ children }) => (
  <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" filter="url(#rough)" aria-hidden="true">
    {children}
  </svg>
);

export const IconBook = () => (
  <Doodle>
    <path d="M6 9c5-2 10-2 14 1v22c-4-3-9-3-14-1z" />
    <path d="M34 9c-5-2-10-2-14 1v22c4-3 9-3 14-1z" />
    <path d="M10 15h6M10 20h6M24 15h6M24 20h5" />
  </Doodle>
);

export const IconCamera = () => (
  <Doodle>
    <rect x="5" y="12" width="30" height="20" rx="3" />
    <path d="M13 12l3-5h8l3 5" />
    <circle cx="20" cy="22" r="6" />
    <circle cx="30" cy="16" r="1" />
  </Doodle>
);

export const IconPencil = () => (
  <Doodle>
    <path d="M8 32l3-9 17-17 6 6-17 17z" />
    <path d="M24 10l6 6M8 32l5-1" />
  </Doodle>
);

export const IconGear = () => (
  <Doodle>
    <circle cx="20" cy="20" r="5" />
    <path d="M20 5v5M20 30v5M5 20h5M30 20h5M9.5 9.5l3.5 3.5M27 27l3.5 3.5M9.5 30.5l3.5-3.5M27 13l3.5-3.5" />
    <circle cx="20" cy="20" r="10" />
  </Doodle>
);

export const IconCalendar = () => (
  <Doodle>
    <rect x="6" y="9" width="28" height="25" rx="2" />
    <path d="M6 16h28M13 5v7M27 5v7" />
    <path d="M12 22h2M19 22h2M26 22h2M12 28h2M19 28h2" />
  </Doodle>
);
