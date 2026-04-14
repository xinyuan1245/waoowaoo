import { TASK_TYPE } from '@/lib/task/types'

export type WorkflowFailureMode = 'fail_run'

export type WorkflowStepDefinition = {
  key: string
  dependsOn: string[]
  retryable: boolean
  artifactTypes: string[]
  failureMode: WorkflowFailureMode
}

export type WorkflowDefinition = {
  workflowType: string
  orderedSteps: WorkflowStepDefinition[]
  resolveRetryInvalidationStepKeys: (params: {
    stepKey: string
    existingStepKeys: string[]
  }) => string[]
}

function uniqueStepKeys(stepKeys: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(stepKeys).filter((stepKey) => stepKey.trim().length > 0)))
}

function resolveStoryToScriptInvalidation(params: {
  stepKey: string
  existingStepKeys: ReadonlySet<string>
}): string[] {
  const affected = new Set<string>([params.stepKey])
  if (
    params.stepKey === 'analyze_characters'
    || params.stepKey === 'analyze_locations'
    || params.stepKey === 'analyze_props'
  ) {
    if (params.existingStepKeys.has('split_clips')) {
      affected.add('split_clips')
    }
    for (const stepKey of params.existingStepKeys) {
      if (stepKey.startsWith('screenplay_')) {
        affected.add(stepKey)
      }
    }
  } else if (params.stepKey === 'split_clips') {
    for (const stepKey of params.existingStepKeys) {
      if (stepKey.startsWith('screenplay_')) {
        affected.add(stepKey)
      }
    }
  }
  return uniqueStepKeys(affected)
}

type StoryboardPhase =
  | 'phase1'
  | 'phase2_cinematography'
  | 'phase2_acting'
  | 'phase3_detail'
  | 'phase4_image_prompt'
  | 'phase5_video_prompt'

function parseStoryboardStepKey(stepKey: string): { clipId: string; phase: StoryboardPhase } | null {
  const match = /^clip_(.+)_(phase1|phase2_cinematography|phase2_acting|phase3_detail|phase4_image_prompt|phase5_video_prompt)$/.exec(stepKey.trim())
  if (!match) return null
  const clipId = (match[1] || '').trim()
  const phase = match[2] as StoryboardPhase
  if (!clipId) return null
  return { clipId, phase }
}

function resolveScriptToStoryboardInvalidation(params: {
  stepKey: string
  existingStepKeys: ReadonlySet<string>
}): string[] {
  const affected = new Set<string>([params.stepKey])
  if (params.stepKey === 'voice_analyze') {
    return uniqueStepKeys(affected)
  }

  const parsed = parseStoryboardStepKey(params.stepKey)
  if (!parsed) {
    return uniqueStepKeys(affected)
  }

  const clipPrefix = `clip_${parsed.clipId}_`
  if (parsed.phase === 'phase1') {
    affected.add(`${clipPrefix}phase2_cinematography`)
    affected.add(`${clipPrefix}phase2_acting`)
    affected.add(`${clipPrefix}phase3_detail`)
    affected.add(`${clipPrefix}phase4_image_prompt`)
    affected.add(`${clipPrefix}phase5_video_prompt`)
    affected.add('voice_analyze')
    return uniqueStepKeys(Array.from(affected).filter((stepKey) => params.existingStepKeys.has(stepKey)))
  }

  if (parsed.phase === 'phase2_cinematography' || parsed.phase === 'phase2_acting') {
    affected.add(`${clipPrefix}phase3_detail`)
    affected.add(`${clipPrefix}phase4_image_prompt`)
    affected.add(`${clipPrefix}phase5_video_prompt`)
    affected.add('voice_analyze')
    return uniqueStepKeys(Array.from(affected).filter((stepKey) => params.existingStepKeys.has(stepKey)))
  }

  if (parsed.phase === 'phase3_detail') {
    affected.add(`${clipPrefix}phase4_image_prompt`)
    affected.add(`${clipPrefix}phase5_video_prompt`)
    affected.add('voice_analyze')
    return uniqueStepKeys(Array.from(affected).filter((stepKey) => params.existingStepKeys.has(stepKey)))
  }

  if (parsed.phase === 'phase4_image_prompt') {
    affected.add(`${clipPrefix}phase5_video_prompt`)
    affected.add('voice_analyze')
    return uniqueStepKeys(Array.from(affected).filter((stepKey) => params.existingStepKeys.has(stepKey)))
  }

  affected.add('voice_analyze')
  return uniqueStepKeys(Array.from(affected).filter((stepKey) => params.existingStepKeys.has(stepKey)))
}

const STORY_TO_SCRIPT_DEFINITION: WorkflowDefinition = {
  workflowType: TASK_TYPE.STORY_TO_SCRIPT_RUN,
  orderedSteps: [
    {
      key: 'analyze_characters',
      dependsOn: [],
      retryable: true,
      artifactTypes: ['analysis.characters'],
      failureMode: 'fail_run',
    },
    {
      key: 'analyze_locations',
      dependsOn: [],
      retryable: true,
      artifactTypes: ['analysis.locations'],
      failureMode: 'fail_run',
    },
    {
      key: 'analyze_props',
      dependsOn: [],
      retryable: true,
      artifactTypes: ['analysis.props'],
      failureMode: 'fail_run',
    },
    {
      key: 'split_clips',
      dependsOn: ['analyze_characters', 'analyze_locations', 'analyze_props'],
      retryable: true,
      artifactTypes: ['clips.split'],
      failureMode: 'fail_run',
    },
    {
      key: 'screenplay_convert',
      dependsOn: ['split_clips'],
      retryable: true,
      artifactTypes: ['screenplay.clip'],
      failureMode: 'fail_run',
    },
    {
      key: 'persist_script_artifacts',
      dependsOn: ['screenplay_convert'],
      retryable: false,
      artifactTypes: [],
      failureMode: 'fail_run',
    },
  ],
  resolveRetryInvalidationStepKeys: ({ stepKey, existingStepKeys }) => resolveStoryToScriptInvalidation({
    stepKey,
    existingStepKeys: new Set(existingStepKeys),
  }),
}

const SCRIPT_TO_STORYBOARD_DEFINITION: WorkflowDefinition = {
  workflowType: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
  orderedSteps: [
    {
      key: 'plan_panels',
      dependsOn: [],
      retryable: true,
      artifactTypes: ['storyboard.clip.phase1'],
      failureMode: 'fail_run',
    },
    {
      key: 'detail_panels',
      dependsOn: ['plan_panels'],
      retryable: true,
      artifactTypes: [
        'storyboard.clip.phase2.cine',
        'storyboard.clip.phase2.acting',
        'storyboard.clip.phase3',
        'storyboard.clip.phase4.image_prompt',
        'storyboard.clip.phase5.video_prompt',
      ],
      failureMode: 'fail_run',
    },
    {
      key: 'voice_analyze',
      dependsOn: ['detail_panels'],
      retryable: true,
      artifactTypes: ['voice.lines'],
      failureMode: 'fail_run',
    },
    {
      key: 'persist_storyboard_artifacts',
      dependsOn: ['detail_panels', 'voice_analyze'],
      retryable: false,
      artifactTypes: [],
      failureMode: 'fail_run',
    },
  ],
  resolveRetryInvalidationStepKeys: ({ stepKey, existingStepKeys }) => resolveScriptToStoryboardInvalidation({
    stepKey,
    existingStepKeys: new Set(existingStepKeys),
  }),
}

const WORKFLOW_DEFINITIONS: Record<string, WorkflowDefinition> = {
  [STORY_TO_SCRIPT_DEFINITION.workflowType]: STORY_TO_SCRIPT_DEFINITION,
  [SCRIPT_TO_STORYBOARD_DEFINITION.workflowType]: SCRIPT_TO_STORYBOARD_DEFINITION,
}

export function getWorkflowDefinition(workflowType: string): WorkflowDefinition | null {
  return WORKFLOW_DEFINITIONS[workflowType] || null
}

export function resolveWorkflowRetryInvalidationStepKeys(params: {
  workflowType: string
  stepKey: string
  existingStepKeys: string[]
}): string[] {
  const definition = getWorkflowDefinition(params.workflowType)
  if (!definition) {
    return uniqueStepKeys([params.stepKey].filter((stepKey) => params.existingStepKeys.includes(stepKey)))
  }
  return definition.resolveRetryInvalidationStepKeys({
    stepKey: params.stepKey,
    existingStepKeys: params.existingStepKeys,
  })
}
