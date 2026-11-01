import { useEffect, useState } from 'react';

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 60_000 - (Date.now() % 60_000));
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

export function Clock({ hour24, large }: { hour24: boolean; large?: boolean }) {
  const now = useNow();
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: !hour24 });
  const date = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className={large ? 'clock clock-large' : 'clock'}>
      <div className="clock-time">{time}</div>
      <div className="clock-date">{date}</div>
    </div>
  );
}
