import { motion } from 'framer-motion';
import { mediaUrl } from '../lib/api.js';
import { shortDate } from '../lib/date.js';
import { Star } from './Decor.jsx';

export default function Polaroid({ media, onClick, index = 0, showDate = false }) {
  const developing = !media.id;
  const tilt = media.tilt ?? 0;
  const tapeAngle = developing ? 0 : ((media.id * 37) % 14) - 7;
  const caption = developing ? 'développement…' : media.caption || (showDate ? shortDate(media.day) : '');

  return (
    <motion.button
      type="button"
      className={`polaroid ${media.kind === 'sketch' ? 'is-sketch' : ''}`}
      onClick={developing ? undefined : onClick}
      initial={{ opacity: 0, y: -40, rotate: tilt - 10, scale: 1.1 }}
      animate={{ opacity: 1, y: 0, rotate: tilt, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8, rotate: tilt + 12 }}
      whileHover={developing ? undefined : { y: -6, rotate: 0, scale: 1.04, zIndex: 5 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20, delay: Math.min(index, 8) * 0.05 }}
      aria-label={caption || 'Ouvrir'}
    >
      <span className="tape" style={{ transform: `translateX(-50%) rotate(${tapeAngle}deg)` }} />
      <span className="polaroid-img">
        {developing ? (
          <span className="developing" />
        ) : (
          <>
            <img src={mediaUrl(media.thumb)} alt="" loading="lazy" draggable={false} />
            {media.overlay && <img className="overlay-img" src={mediaUrl(media.overlay)} alt="" loading="lazy" draggable={false} />}
          </>
        )}
      </span>
      <span className="polaroid-caption">{caption}</span>
      {!developing && media.id % 3 === 0 && <Star className="polaroid-star" size={26} delay={0.3 + index * 0.05} />}
    </motion.button>
  );
}
