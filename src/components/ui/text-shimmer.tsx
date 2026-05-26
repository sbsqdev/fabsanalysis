import React, { useMemo, type JSX } from 'react';
import { motion } from 'framer-motion';

interface TextShimmerProps {
  children: string;
  as?: React.ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

export function TextShimmer({
  children,
  as: Component = 'p',
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) {
  const MotionComponent = motion(Component as keyof JSX.IntrinsicElements);

  const dynamicSpread = useMemo(() => {
    return children.length * spread;
  }, [children, spread]);

  return (
    <MotionComponent
      className={[
        'relative inline-block bg-[length:250%_100%,auto] bg-clip-text',
        'text-transparent',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      initial={{ backgroundPosition: '100% center' }}
      animate={{ backgroundPosition: '0% center' }}
      transition={{
        repeat: Infinity,
        duration,
        ease: 'linear',
      }}
      style={
        {
          '--spread': `${dynamicSpread}px`,
          backgroundImage: `linear-gradient(90deg, transparent calc(50% - var(--spread)), #6366f1, transparent calc(50% + var(--spread))), linear-gradient(#6b7280, #6b7280)`,
          backgroundRepeat: 'no-repeat, padding-box',
        } as React.CSSProperties
      }
    >
      {children}
    </MotionComponent>
  );
}
