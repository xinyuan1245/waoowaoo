'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { resolveErrorDisplay } from '@/lib/errors/display'
import TaskStatusOverlay from '@/components/task/TaskStatusOverlay'
import type { TaskPresentationState } from '@/lib/task/presentation'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'

type CharacterCardGalleryProps =
  | {
    mode: 'selection'
    characterId: string
    appearanceId: string
    characterName: string
    imageUrlsWithIndex: Array<{ url: string; originalIndex: number }>
    selectedIndex: number | null
    isGroupTaskRunning: boolean
    isImageTaskRunning: (imageIndex: number) => boolean
    displayTaskPresentation: TaskPresentationState | null
    onImageClick: (imageUrl: string) => void
    onSelectImage?: (characterId: string, appearanceId: string, imageIndex: number | null) => void
  }
  | {
    mode: 'single'
    characterName: string
    changeReason: string
    aspectClassName: string
    currentImageUrl: string | null | undefined
    selectedIndex: number | null
    hasMultipleImages: boolean
    isAppearanceTaskRunning: boolean
    displayTaskPresentation: TaskPresentationState | null
    appearanceErrorMessage?: string | null
    onImageClick: (imageUrl: string) => void
    overlayActions: ReactNode
  }

export default function CharacterCardGallery(props: CharacterCardGalleryProps) {
  const t = useTranslations('assets')

  if (props.mode === 'selection') {
    const angleCount = 4
    const isAngleGrouped = props.imageUrlsWithIndex.length >= angleCount && props.imageUrlsWithIndex.length % angleCount === 0
    const groupCount = isAngleGrouped ? Math.floor(props.imageUrlsWithIndex.length / angleCount) : 0
    const selectedGroupIndex = isAngleGrouped && props.selectedIndex !== null && props.selectedIndex !== undefined
      ? Math.floor(props.selectedIndex / angleCount)
      : null

    if (isAngleGrouped) {
      return (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: groupCount }, (_v, groupIdx) => {
            const start = groupIdx * angleCount
            const groupItems = props.imageUrlsWithIndex.slice(start, start + angleCount)
            const isThisSelected = selectedGroupIndex === groupIdx
            const anyTaskRunning = groupItems.some(({ originalIndex }) => props.isImageTaskRunning(originalIndex)) || props.isGroupTaskRunning
            const optionNumber = groupIdx + 1

            return (
              <div key={groupIdx} className="relative group/thumb">
                <div
                  className={`rounded-lg overflow-hidden border-2 transition-all cursor-pointer relative ${isThisSelected
                    ? 'border-[var(--glass-stroke-success)] ring-2 ring-[var(--glass-focus-ring)]'
                    : 'border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-focus)]'
                    }`}
                >
                  <div className="grid grid-cols-2 gap-1 bg-[var(--glass-bg-muted)] p-1">
                    {groupItems.map(({ url, originalIndex }, idx) => (
                      <div
                        key={originalIndex}
                        onClick={() => props.onImageClick(url)}
                        className="rounded overflow-hidden bg-[var(--glass-bg-surface)]"
                        title={t('image.optionNumber', { number: optionNumber })}
                      >
                        <MediaImageWithLoading
                          src={url}
                          alt={`${props.characterName} - ${t('image.optionNumber', { number: optionNumber })} - ${idx + 1}`}
                          containerClassName="w-full min-h-[72px]"
                          className="w-full h-auto object-contain"
                        />
                      </div>
                    ))}
                  </div>

                  {anyTaskRunning && (
                    <TaskStatusOverlay state={props.displayTaskPresentation} />
                  )}

                  <div
                    className={`absolute bottom-2 left-2 flex items-center gap-1 text-white text-xs px-2 py-0.5 rounded ${isThisSelected ? 'bg-[var(--glass-tone-success-fg)]' : 'bg-[var(--glass-overlay)]'
                      }`}
                  >
                    <span>{t('image.optionNumber', { number: optionNumber })}</span>
                    {isThisSelected && (
                      <AppIcon name="checkTiny" className="h-3 w-3" />
                    )}
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!anyTaskRunning) {
                        // 选择时，落到“该方案-正面全身”（offset=1）
                        const pickIndex = start + 1
                        const selected = props.selectedIndex !== null && props.selectedIndex !== undefined && selectedGroupIndex === groupIdx
                        props.onSelectImage?.(props.characterId, props.appearanceId, selected ? null : pickIndex)
                      }
                    }}
                    disabled={anyTaskRunning}
                    className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-sm ${isThisSelected
                      ? 'bg-[var(--glass-tone-success-fg)] text-white'
                      : 'bg-[var(--glass-bg-surface-strong)] hover:bg-[var(--glass-accent-from)] hover:text-white'
                      } disabled:opacity-50`}
                    title={isThisSelected ? t('image.cancelSelection') : t('image.useThis')}
                  >
                    <AppIcon name="check" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )
    }

    return (
      <div className="grid grid-cols-3 gap-3">
        {props.imageUrlsWithIndex.map(({ url, originalIndex }) => {
          const isThisSelected = props.selectedIndex === originalIndex
          const isThisTaskRunning = props.isImageTaskRunning(originalIndex) || props.isGroupTaskRunning
          return (
            <div key={originalIndex} className="relative group/thumb">
              <div
                onClick={() => props.onImageClick(url)}
                className={`rounded-lg overflow-hidden border-2 transition-all cursor-pointer relative ${isThisSelected
                  ? 'border-[var(--glass-stroke-success)] ring-2 ring-[var(--glass-focus-ring)]'
                  : 'border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-focus)]'
                  }`}
              >
                <MediaImageWithLoading
                  src={url}
                  alt={`${props.characterName} - ${t('image.optionNumber', { number: originalIndex + 1 })}`}
                  containerClassName="w-full min-h-[96px]"
                  className="w-full h-auto object-contain"
                />

                {isThisTaskRunning && (
                  <TaskStatusOverlay state={props.displayTaskPresentation} />
                )}

                <div
                  className={`absolute bottom-2 left-2 flex items-center gap-1 text-white text-xs px-2 py-0.5 rounded ${isThisSelected ? 'bg-[var(--glass-tone-success-fg)]' : 'bg-[var(--glass-overlay)]'
                    }`}
                >
                  <span>{t('image.optionNumber', { number: originalIndex + 1 })}</span>
                  {isThisSelected && (
                    <AppIcon name="checkTiny" className="h-3 w-3" />
                  )}
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!isThisTaskRunning) {
                      props.onSelectImage?.(props.characterId, props.appearanceId, isThisSelected ? null : originalIndex)
                    }
                  }}
                  disabled={isThisTaskRunning}
                  className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-sm ${isThisSelected
                    ? 'bg-[var(--glass-tone-success-fg)] text-white'
                    : 'bg-[var(--glass-bg-surface-strong)] hover:bg-[var(--glass-accent-from)] hover:text-white'
                    } disabled:opacity-50`}
                  title={isThisSelected ? t('image.cancelSelection') : t('image.useThis')}
                >
                  <AppIcon name="check" className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const appearanceErrorDisplay = resolveErrorDisplay({
    code: props.appearanceErrorMessage || null,
    message: props.appearanceErrorMessage || null,
  })

  return (
    <div className={`relative overflow-hidden rounded-lg border-2 border-[var(--glass-stroke-base)] ${props.aspectClassName}`}>
      {props.currentImageUrl ? (
        <div className="relative h-full w-full">
          <MediaImageWithLoading
            src={props.currentImageUrl}
            alt={`${props.characterName} - ${props.changeReason}`}
            containerClassName="h-full w-full"
            className="h-full w-full object-contain cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => props.onImageClick(props.currentImageUrl!)}
          />
          {props.selectedIndex !== null && props.hasMultipleImages && (
            <div className="absolute bottom-2 left-2 bg-[var(--glass-tone-success-fg)] text-white text-xs px-2 py-0.5 rounded">
              {t('image.optionNumber', { number: props.selectedIndex + 1 })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[var(--glass-bg-muted)]">
          {appearanceErrorDisplay && !props.isAppearanceTaskRunning ? (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
              <AppIcon name="alert" className="w-8 h-8 text-[var(--glass-tone-danger-fg)] mb-2" />
              <div className="text-[var(--glass-tone-danger-fg)] text-xs font-medium mb-1">{t('common.generateFailed')}</div>
              <div className="text-[var(--glass-tone-danger-fg)] text-xs max-w-full break-words">{appearanceErrorDisplay.message}</div>
            </div>
          ) : (
            <AppIcon name="userAlt" className="w-8 h-8 text-[var(--glass-text-tertiary)]" />
          )}
        </div>
      )}
      {props.isAppearanceTaskRunning && (
        <TaskStatusOverlay state={props.displayTaskPresentation} />
      )}
      {!props.isAppearanceTaskRunning && (
        <div className="absolute top-2 left-2 flex gap-1">
          {props.overlayActions}
        </div>
      )}
    </div>
  )
}
