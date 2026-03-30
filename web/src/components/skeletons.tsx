export function SkeletonCard({ className = "h-28" }: { className?: string }) {
  return <div className={`${className} w-full rounded-2xl bg-[#1E2D45] dark:bg-[#1E2D45] light:bg-gray-200 animate-pulse`} />;
}

export function SkeletonRow({ className = "h-14" }: { className?: string }) {
  return <div className={`${className} w-full rounded-xl bg-[#1E2D45] animate-pulse`} />;
}

export function SkeletonTile({ className = "h-36" }: { className?: string }) {
  return <div className={`${className} min-w-[190px] flex-1 rounded-2xl bg-[#1E2D45] animate-pulse`} />;
}
