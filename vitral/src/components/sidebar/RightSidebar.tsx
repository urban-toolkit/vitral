import AssetsPanel from "@/components/files/AssetsPanel";
import { GitHubFiles } from "@/components/github/GithubFiles";
import type { fileRecord } from "@/config/types";
import styles from "./RightSidebar.module.css";

type RightSidebarProps = {
    projectId: string;
    connectionStatus: { connected: boolean; user?: { id: number; login: string } };
    assetsRecords: fileRecord[];
    reviewOnly?: boolean;
    bottomOffsetPx?: number;
    onAssetHover?: (fileId: string | null) => void;
    deletingAssetId?: string | null;
    onDeleteAsset?: (file: fileRecord) => void;
};

export function RightSidebar({
    projectId,
    connectionStatus,
    assetsRecords,
    reviewOnly = false,
    bottomOffsetPx = 0,
    onAssetHover,
    deletingAssetId,
    onDeleteAsset,
}: RightSidebarProps) {
    const sidebarHeight = `calc(100vh - ${Math.max(0, bottomOffsetPx)}px)`;

    return (
        <aside className={styles.root} style={{ height: sidebarHeight }}>
            <div className={styles.panel}>
                <div className={styles.section}>
                    <GitHubFiles
                        projectId={projectId}
                        connectionStatus={connectionStatus}
                        reviewOnly={reviewOnly}
                        className={styles.sectionCard}
                    />
                </div>

                <div className={`${styles.section} ${styles.assetsSection}`}>
                    <AssetsPanel
                        records={assetsRecords}
                        title="Assets"
                        className={styles.sectionCard}
                        onAssetHover={onAssetHover}
                        deletingFileId={deletingAssetId}
                        onDeleteAsset={onDeleteAsset}
                    />
                </div>
            </div>
        </aside>
    );
}
