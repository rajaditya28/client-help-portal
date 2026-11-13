import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HelpRequestDto, SocketEvents } from '@help/shared';
import type { AuthUser } from '../auth/auth.types';
import { ownedBy } from '../common/access';
import { PERSON_SELECT, toRequestDto } from '../common/mappers';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

const REQUEST_INCLUDE = {
  client: PERSON_SELECT,
  consultant: PERSON_SELECT,
  // The in-progress call, if any, so the UI can offer "Join call".
  calls: { where: { status: { not: 'ENDED' as const } }, select: { id: true }, take: 1 },
};

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(client: AuthUser, input: { title: string; description: string }): Promise<HelpRequestDto> {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: client.id } });
    if (!me.consultantId) throw new BadRequestException('No consultant is assigned to your account');

    const row = await this.prisma.helpRequest.create({
      data: {
        title: input.title.trim(),
        description: input.description.trim(),
        clientId: me.id,
        consultantId: me.consultantId,
      },
      include: REQUEST_INCLUDE,
    });
    const dto = toRequestDto(row);
    // Push to the consultant's dashboard (and the client's other tabs) immediately.
    this.realtime.toUsers([row.consultantId, row.clientId], SocketEvents.RequestCreated, dto);
    return dto;
  }

  async list(user: AuthUser): Promise<HelpRequestDto[]> {
    const rows = await this.prisma.helpRequest.findMany({
      where: ownedBy(user),
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRequestDto);
  }

  async get(user: AuthUser, id: string): Promise<HelpRequestDto> {
    const row = await this.prisma.helpRequest.findFirst({ where: { id, ...ownedBy(user) }, include: REQUEST_INCLUDE });
    if (!row) throw new NotFoundException('Request not found');
    return toRequestDto(row);
  }

  async resolve(user: AuthUser, id: string): Promise<HelpRequestDto> {
    const found = await this.prisma.helpRequest.findFirst({ where: { id, ...ownedBy(user) }, select: { id: true } });
    if (!found) throw new NotFoundException('Request not found');
    const row = await this.prisma.helpRequest.update({
      where: { id },
      data: { status: 'RESOLVED' },
      include: REQUEST_INCLUDE,
    });
    return this.publish(toRequestDto(row));
  }

  /** Re-reads a request and pushes it to both participants. Used by the calls flow. */
  async refreshAndPublish(id: string): Promise<HelpRequestDto> {
    const row = await this.prisma.helpRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
    return this.publish(toRequestDto(row));
  }

  private publish(dto: HelpRequestDto): HelpRequestDto {
    this.realtime.toUsers([dto.client.id, dto.consultant.id], SocketEvents.RequestUpdated, dto);
    return dto;
  }
}
