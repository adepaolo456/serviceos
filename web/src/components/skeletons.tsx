export function SkeletonCard({ className = "h-28" }: { className?: string }) {
  return <div className={`${className} w-full rounded-[18px] skeleton`} />;
}

export function SkeletonRow({ className = "h-14" }: { className?: string }) {
  return <div className={`${className} w-full rounded-xl skeleton`} />;
}

export function SkeletonTile({ className = "h-36" }: { className?: string }) {
  return <div className={`${className} min-w-[190px] flex-1 rounded-[18px] skeleton`} />;
}
