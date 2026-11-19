import { BilingualText } from '@/ui/translation/BilingualText';
import { CalendarDays, Flag, PlayCircle, Tag, User } from 'lucide-preact';
import type { Build } from '@/lib/build/model';
import { formatUpdated, videoHost } from '@/lib/ui/overview';
import { Icon } from '@/ui/common/Icon';

/** Build identity and meta; purely informational — page controls live in the tab bar. */
export function BuildHeader({ build }: { build: Build }) {
  const updated = formatUpdated(build.updatedAt);
  const host = build.videoUrl ? videoHost(build.videoUrl) : null;

  return (
    <header class="build-header">
      <Icon src={build.headerImageUrl} class="build-header__art" loading="eager" />
      <div class="build-header__identity">
        <h1 class="build-header__title"><BilingualText text={build.title} inline /></h1>
        {(build.className || build.ascendancy) && (
          <p class="build-header__hero">
            {build.className && <BilingualText text={build.className} inline />}
            {build.className && build.ascendancy && <span class="build-header__separator">/</span>}
            {build.ascendancy && <BilingualText text={build.ascendancy} inline />}
          </p>
        )}
        <ul class="build-header__meta">
          {build.patch && (
            <li>
              <Tag size={14} aria-hidden="true" />
              <span>{build.patch}</span>
            </li>
          )}
          {build.buildTypes.length > 0 && (
            <li>
              <Flag size={14} aria-hidden="true" />
              <span>{build.buildTypes.join(' · ')}</span>
            </li>
          )}
          {build.author && (
            <li>
              <User size={14} aria-hidden="true" />
              <span>{build.author}</span>
            </li>
          )}
          {updated && (
            <li>
              <CalendarDays size={14} aria-hidden="true" />
              <span><span class="build-header__meta-label">Updated</span> {updated}</span>
            </li>
          )}
          {build.videoUrl && host && (
            <li>
              <a class="build-header__video" href={build.videoUrl} target="_blank" rel="noopener noreferrer" aria-label={`Video guide on ${host}`}>
                <PlayCircle size={14} aria-hidden="true" />
                <span>Video guide</span>
                <span class="build-header__video-host">{host}</span>
              </a>
            </li>
          )}
        </ul>
      </div>
    </header>
  );
}
