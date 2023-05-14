import { Lock } from 'redlock'
import { isNil } from 'lodash'
import { ActivepiecesError, apId, ErrorCode, FlowId, ProjectId, WebhookSimulation } from '@activepieces/shared'
import { acquireLock } from '../../database/redis-connection'
import { databaseConnection } from '../../database/database-connection'
import { WebhookSimulationEntity } from './webhook-simulation-entity'
import { webhookSideEffects } from './webhook-simulation-side-effects'
import { logger } from '../../helper/logger'

type BaseParams = {
    flowId: FlowId
    projectId: ProjectId
}

type DeleteParams = BaseParams
type GetParams = BaseParams
type CreateParams = BaseParams

type AcquireLockParams = {
    flowId: FlowId
    op: 'create' | 'delete'
}

const createLock = async ({ flowId, op }: AcquireLockParams): Promise<Lock> => {
    const key = `${flowId}-${op}-webhook-simulation`
    return await acquireLock({ key, timeout: 1000 })
}

const webhookSimulationRepo = databaseConnection.getRepository(WebhookSimulationEntity)

export const webhookSimulationService = {
    async create(params: CreateParams): Promise<WebhookSimulation> {
        logger.debug(params, '[WebhookSimulationService#deleteByFlowId] params')

        const { flowId, projectId } = params

        const lock = await createLock({
            flowId,
            op: 'create',
        })

        try {
            const webhookSimulationExists = await webhookSimulationRepo.exist({ where: { flowId } })

            if (webhookSimulationExists) {
                await this.delete({
                    flowId,
                    projectId,
                })
            }

            const webhookSimulation: Omit<WebhookSimulation, 'created' | 'updated'> = {
                id: apId(),
                ...params,
            }

            await webhookSideEffects.preCreate({
                flowId,
                projectId,
            })

            return await webhookSimulationRepo.save(webhookSimulation)
        }
        finally {
            await lock.release()
        }
    },

    async get(params: GetParams): Promise<WebhookSimulation> {
        logger.debug(params, '[WebhookSimulationService#getByFlowId] params')

        const { flowId, projectId } = params

        const webhookSimulation = await webhookSimulationRepo.findOneBy({
            flowId,
            projectId,
        })

        if (isNil(webhookSimulation)) {
            logger.debug('[WebhookSimulationService#getByFlowId] not found')
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    message: `entityType=webhookSimulation flowId=${flowId} projectId=${projectId}`,
                },
            })
        }

        return webhookSimulation
    },

    async delete(params: DeleteParams): Promise<void> {
        logger.debug(params, '[WebhookSimulationService#deleteByFlowId] params')

        const { flowId, projectId } = params

        const lock = await createLock({
            flowId,
            op: 'delete',
        })

        try {
            const webhookSimulation = await this.get({
                flowId,
                projectId,
            })

            await webhookSideEffects.preDelete({
                flowId,
                projectId,
            })

            await webhookSimulationRepo.remove(webhookSimulation)
        }
        finally {
            await lock.release()
        }
    },
}
