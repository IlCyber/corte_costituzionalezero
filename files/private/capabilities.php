<?php
declare(strict_types=1);

/**
 * Registro centrale delle capacità atomiche dell'applicazione.
 *
 * legacyPermission/legacyAction servono esclusivamente a migrare senza perdita
 * i ruoli creati con la precedente matrice area × azione. Le nuove verifiche
 * usano sempre capabilityKey.
 *
 * @return array<int, array{key:string,label:string,group:string,dangerous:bool,legacyPermission:string,legacyAction:string}>
 */
function applicationCapabilityCatalog(): array
{
    $items = [];
    $add = static function (string $group, string $legacyPermission, array $definitions) use (&$items): void {
        foreach ($definitions as $definition) {
            [$key, $label, $legacyAction, $dangerous, $legacyOverride] = array_pad($definition, 5, null);
            $items[] = [
                'key' => $key,
                'label' => $label,
                'group' => $group,
                'dangerous' => (bool) $dangerous,
                'legacyPermission' => is_string($legacyOverride) && $legacyOverride !== '' ? $legacyOverride : $legacyPermission,
                'legacyAction' => $legacyAction,
            ];
        }
    };

    $add('Documenti', 'documents', [
        ['documents.view', 'Visualizzare elenco e schede', 'view'],
        ['documents.create', 'Creare documenti', 'create'],
        ['documents.edit', 'Modificare dati e contenuto', 'edit'],
        ['documents.change_number', 'Cambiare numero progressivo', 'edit'],
        ['documents.change_publication', 'Cambiare stato di pubblicazione', 'approve'],
        ['documents.open_google', 'Aprire il documento Google', 'view'],
        ['documents.print', 'Stampare documenti', 'download', false, 'documents_pdf'],
        ['documents.rename_google', 'Rinominare il file Google', 'edit'],
        ['documents.download_pdf', 'Scaricare il PDF', 'download', false, 'documents_pdf'],
        ['documents.trash', 'Spostare documenti nel cestino', 'delete', true],
        ['documents.restore', 'Ripristinare documenti', 'restore'],
        ['documents.purge', 'Eliminare definitivamente documenti', 'purge', true],
    ]);
    $add('ODG', 'odg', [
        ['odg.view', 'Visualizzare gli ODG', 'view'],
        ['odg.create', 'Creare ODG', 'create'],
        ['odg.edit', 'Modificare ODG', 'edit'],
        ['odg.change_evaluation', 'Cambiare stato valutato/da valutare', 'approve'],
        ['odg.change_publication', 'Cambiare stato di pubblicazione', 'approve'],
        ['odg.open_google', 'Aprire ODG su Google', 'view'],
        ['odg.download_pdf', 'Scaricare PDF degli ODG', 'download', false, 'documents_pdf'],
        ['odg.trash', 'Spostare ODG nel cestino', 'delete', true],
        ['odg.restore', 'Ripristinare ODG', 'restore'],
        ['odg.purge', 'Eliminare definitivamente ODG', 'purge', true],
    ]);
    $add('Template', 'templates', [
        ['templates.view', 'Visualizzare template', 'view'],
        ['templates.create', 'Creare template', 'create'],
        ['templates.edit', 'Modificare template', 'edit'],
        ['templates.use', 'Usare un template', 'view'],
        ['templates.open_google', 'Aprire template su Google', 'view'],
        ['templates.rename_google', 'Rinominare template su Google', 'edit'],
        ['templates.download_pdf', 'Scaricare PDF dei template', 'download', false, 'documents_pdf'],
        ['templates.trash', 'Spostare template nel cestino', 'delete', true],
        ['templates.restore', 'Ripristinare template', 'restore'],
        ['templates.purge', 'Eliminare definitivamente template', 'purge', true],
    ]);
    $add('Partiti', 'parties', [
        ['parties.view', 'Visualizzare partiti', 'view'],
        ['parties.create', 'Creare partiti', 'create'],
        ['parties.edit', 'Modificare dati dei partiti', 'edit'],
        ['parties.change_status', 'Cambiare stato dei partiti', 'approve'],
        ['parties.view_history', 'Consultare storico dei partiti', 'view'],
        ['parties.trash', 'Spostare partiti nel cestino', 'delete', true],
        ['parties.restore', 'Ripristinare partiti', 'restore'],
        ['parties.purge', 'Eliminare definitivamente partiti', 'purge', true],
        ['party_statutes.view', 'Visualizzare statuti', 'view'],
        ['party_statutes.create', 'Creare statuti Google', 'create'],
        ['party_statutes.edit', 'Modificare statuti', 'edit'],
        ['party_statutes.view_history', 'Consultare e confrontare versioni', 'view'],
        ['party_statutes.download_pdf', 'Scaricare PDF degli statuti', 'download', false, 'documents_pdf'],
    ]);
    $add('Coalizioni', 'parties', [
        ['coalitions.view', 'Visualizzare coalizioni', 'view'],
        ['coalitions.create', 'Creare coalizioni', 'create'],
        ['coalitions.edit', 'Modificare coalizioni', 'edit'],
        ['coalitions.change_status', 'Cambiare stato delle coalizioni', 'approve'],
        ['coalitions.manage_parties', 'Cambiare i partiti aderenti', 'edit'],
        ['coalitions.trash', 'Spostare coalizioni nel cestino', 'delete', true],
        ['coalitions.restore', 'Ripristinare coalizioni', 'restore'],
        ['coalitions.purge', 'Eliminare definitivamente coalizioni', 'purge', true],
    ]);
    $add('Aziende', 'companies', [
        ['companies.view', 'Visualizzare aziende', 'view'],
        ['companies.create', 'Creare aziende', 'create'],
        ['companies.edit', 'Modificare aziende', 'edit'],
        ['companies.view_history', 'Consultare storico aziende', 'view'],
        ['companies.trash', 'Spostare aziende nel cestino', 'delete', true],
        ['companies.restore', 'Ripristinare aziende', 'restore'],
        ['companies.purge', 'Eliminare definitivamente aziende', 'purge', true],
        ['company_regulations.view', 'Visualizzare regolamenti', 'view'],
        ['company_regulations.create', 'Creare regolamenti Google', 'create'],
        ['company_regulations.edit', 'Modificare regolamenti', 'edit'],
        ['company_regulations.view_history', 'Consultare e confrontare versioni', 'view'],
        ['company_regulations.download_pdf', 'Scaricare PDF dei regolamenti', 'download', false, 'documents_pdf'],
    ]);
    $add('Parlamento · mandati', 'parliament', [
        ['parliament.mandates.view', 'Visualizzare mandati', 'view'],
        ['parliament.mandates.create', 'Creare mandati', 'create'],
        ['parliament.mandates.edit', 'Modificare periodo e stato', 'edit'],
        ['parliament.mandates.trash', 'Spostare mandati nel cestino', 'delete', true],
        ['parliament.mandates.restore', 'Ripristinare mandati', 'restore'],
        ['parliament.mandates.purge', 'Eliminare definitivamente mandati', 'purge', true],
    ]);
    $add('Parlamento · nomine', 'parliament', [
        ['parliament.members.view', 'Visualizzare parlamentari', 'view'],
        ['parliament.members.create', 'Creare nomine', 'create'],
        ['parliament.members.edit', 'Modificare informazioni delle nomine', 'edit'],
        ['parliament.members.change_role', 'Cambiare ruolo di una nomina', 'edit'],
        ['parliament.members.resign', 'Registrare dimissioni', 'approve'],
        ['parliament.members.change_resignation_date', 'Correggere data delle dimissioni', 'edit'],
        ['parliament.members.undo_resignation', 'Annullare dimissioni', 'approve', true],
        ['parliament.members.trash', 'Spostare nomine nel cestino', 'delete', true],
        ['parliament.members.restore', 'Ripristinare nomine', 'restore'],
        ['parliament.members.purge', 'Eliminare definitivamente nomine', 'purge', true],
    ]);
    $add('Parlamento · configurazione', 'settings', [
        ['parliament.configuration.roles_create', 'Creare ruoli parlamentari', 'create'],
        ['parliament.configuration.roles_edit', 'Rinominare ruoli e cambiare limiti', 'edit'],
        ['parliament.configuration.roles_delete', 'Eliminare ruoli parlamentari', 'delete', true],
        ['parliament.configuration.fields_create', 'Creare campi aggiuntivi', 'create'],
        ['parliament.configuration.fields_delete', 'Eliminare campi aggiuntivi', 'delete', true],
    ]);

    foreach ([['government', 'Governo'], ['composition', 'Corte costituzionale']] as [$prefix, $label]) {
        $add($label . ' · schede', $prefix, [
            ["{$prefix}.records.view", 'Visualizzare schede', 'view'],
            ["{$prefix}.records.create", 'Creare schede', 'create'],
            ["{$prefix}.records.edit", 'Modificare periodo e stato', 'edit'],
            ["{$prefix}.records.trash", 'Spostare schede nel cestino', 'delete', true],
            ["{$prefix}.records.restore", 'Ripristinare schede', 'restore'],
            ["{$prefix}.records.purge", 'Eliminare definitivamente schede', 'purge', true],
        ]);
        $add($label . ' · componenti', $prefix, [
            ["{$prefix}.members.view", 'Visualizzare componenti', 'view'],
            ["{$prefix}.members.create", 'Creare nomine', 'create'],
            ["{$prefix}.members.edit", 'Modificare nomine', 'edit'],
            ["{$prefix}.members.change_role", 'Cambiare ruolo', 'edit'],
            ["{$prefix}.members.end", 'Registrare cessazioni', 'approve'],
            ["{$prefix}.members.change_end_date", 'Correggere data di cessazione', 'edit'],
            ["{$prefix}.members.undo_end", 'Annullare una cessazione', 'approve', true],
            ["{$prefix}.members.trash", 'Spostare componenti nel cestino', 'delete', true],
            ["{$prefix}.members.restore", 'Ripristinare componenti', 'restore'],
            ["{$prefix}.members.purge", 'Eliminare definitivamente componenti', 'purge', true],
            ["{$prefix}.configuration.roles_create", 'Creare ruoli', 'create'],
            ["{$prefix}.configuration.roles_edit", 'Rinominare ruoli e cambiare limiti', 'edit'],
            ["{$prefix}.configuration.roles_delete", 'Eliminare ruoli', 'delete', true],
        ]);
    }
    $add('Interpretazioni', 'interpretations', [
        ['interpretations.view', 'Visualizzare interpretazioni', 'view'],
        ['interpretations.create', 'Creare interpretazioni', 'create'],
        ['interpretations.edit', 'Modificare interpretazioni', 'edit'],
        ['interpretations.trash', 'Spostare interpretazioni nel cestino', 'delete', true],
        ['interpretations.restore', 'Ripristinare interpretazioni', 'restore'],
        ['interpretations.purge', 'Eliminare definitivamente interpretazioni', 'purge', true],
        ['interpretations.configuration.fields_create', 'Creare valori base', 'create'],
        ['interpretations.configuration.fields_delete', 'Eliminare valori base', 'delete', true],
    ]);
    $add('Link utili', 'useful_links', [
        ['useful_links.view', 'Visualizzare link', 'view'],
        ['useful_links.open', 'Aprire link esterni', 'view'],
        ['useful_links.create', 'Creare link', 'create'],
        ['useful_links.edit', 'Modificare link', 'edit'],
        ['useful_links.trash', 'Spostare link nel cestino', 'delete', true],
        ['useful_links.restore', 'Ripristinare link', 'restore'],
        ['useful_links.purge', 'Eliminare definitivamente link', 'purge', true],
    ]);
    $add('Tools', 'tools', [
        ['tools.view', 'Visualizzare i tools', 'view'],
        ['tools.open', 'Aprire i tools', 'view'],
    ]);
    $add('Impostazioni generali', 'settings', [
        ['settings.view', 'Visualizzare impostazioni', 'view'],
        ['settings.categories.create', 'Creare categorie', 'create'],
        ['settings.categories.delete', 'Eliminare categorie', 'delete', true],
        ['settings.counters.edit', 'Modificare contatori', 'edit'],
        ['settings.number_padding.edit', 'Modificare cifre dei progressivi', 'edit'],
        ['settings.page_margins.edit', 'Modificare margini pagina', 'edit'],
        ['settings.party_fields.create', 'Creare campi dei partiti', 'create'],
        ['settings.party_fields.delete', 'Eliminare campi dei partiti', 'delete', true],
        ['settings.coalition_fields.create', 'Creare campi delle coalizioni', 'create'],
        ['settings.coalition_fields.delete', 'Eliminare campi delle coalizioni', 'delete', true],
    ]);
    $add('Google', 'documents', [
        ['google.account.connect', 'Collegare il proprio account Google', 'view'],
        ['google.account.disconnect', 'Scollegare il proprio account Google', 'view'],
        ['google.sync_names', 'Sincronizzare nomi con Drive', 'edit'],
    ]);
    $add('Utenti', 'users', [
        ['users.view', 'Visualizzare utenti e richieste', 'view'],
        ['users.change_role', 'Cambiare ruolo agli utenti', 'edit', true],
        ['users.trash', 'Disattivare utenti', 'delete', true],
        ['users.restore', 'Ripristinare utenti', 'restore'],
        ['users.purge', 'Eliminare definitivamente utenti', 'purge', true],
        ['registrations.approve', 'Approvare registrazioni', 'approve'],
        ['registrations.reject', 'Rifiutare registrazioni', 'approve'],
        ['password_resets.approve', 'Approvare recuperi password', 'approve'],
    ]);
    $add('Ruoli e permessi', 'roles', [
        ['roles.view', 'Visualizzare ruoli e capacità', 'view'],
        ['roles.create', 'Creare ruoli', 'create'],
        ['roles.edit_permissions', 'Modificare capacità dei ruoli', 'edit', true],
        ['roles.delete', 'Eliminare ruoli', 'delete', true],
    ]);
    $add('Sicurezza', 'logs', [
        ['security_logs.view', 'Consultare log di sicurezza', 'view'],
        ['security_logs.view_network', 'Visualizzare IP e user agent', 'view'],
    ]);

    return $items;
}
