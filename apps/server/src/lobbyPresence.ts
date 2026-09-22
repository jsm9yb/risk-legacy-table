/** A player stays present until their last socket leaves that campaign. */
export class LobbyPresence {
  private campaigns = new Map<string, Map<string, Set<string>>>();

  join(campaignId: string, userId: string, socketId: string): void {
    const users = this.campaigns.get(campaignId) ?? new Map<string, Set<string>>();
    const sockets = users.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    users.set(userId, sockets);
    this.campaigns.set(campaignId, users);
  }

  /** Returns true only when this departure removes the player's last socket. */
  leave(campaignId: string, userId: string, socketId: string): boolean {
    const users = this.campaigns.get(campaignId);
    const sockets = users?.get(userId);
    if (!sockets?.delete(socketId) || sockets.size > 0) return false;
    users!.delete(userId);
    if (users!.size === 0) this.campaigns.delete(campaignId);
    return true;
  }
}
