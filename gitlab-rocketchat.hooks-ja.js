/* eslint no-console:0, max-len:0, complexity:0 */
// see https://gitlab.com/help/web_hooks/web_hooks for full json posted by GitLab
const MENTION_ALL_ALLOWED = false; // <- check that bot permission 'mention-all' are activated in rocketchat before passing this to true.
const NOTIF_COLOR = '#6498CC';
const IGNORE_CONFIDENTIAL = true;
const IGNORE_UNKNOWN_EVENTS = false;
const IGNORE_ERROR_MESSAGES = false;
const USE_ROCKETCHAT_AVATAR = true;
const DEFAULT_AVATAR = null; // <- null means use the avatar from settings if no other is available
const CONVERT_USER_NAME = false;
const STATUSES_COLORS = {
	success: '#2faa60',
	pending: '#e75e40',
	failed: '#d22852',
	canceled: '#5c5c5c',
	created: '#ffc107',
	running: '#607d8b',
};
const ACTION_VERBS = {
	create: '作成',
	destroy: '削除',
	update: '更新',
	rename: 'リネーム',
	transfer: '移行',
	add: '追加',
	remove: '削除',
	open: '起票',
	merge: 'マージ',
	close: 'クローズ',
	reopen: '再開',
};
const NOTIF_ISSUE_ACTION = {
	open: true,
	update: false,
	close: false,
	reopen: false,
};
const NOTIF_MR_ACTION = {
	open: true,
	update: false,
	merge: true,
	close: false,
};
const NOTIF_PIPELINE_STATUSES = {
	running: false,
	pending: false,
	success: true,
	failed: true,
	canceled: false,
	skipped: false,
};
const CHAT_ACCOUNTS = {
	gitlab_user1: 'chat_user1',
	gitlab_user2: 'chat_user2',
};
const ATTACHMENT_TITLE_SIZE = 0; // Put 0 here to have not title as in previous versions
const refParser = (ref) => ref.replace(/^refs\/(?:tags|heads)\/(.+)$/, '$1');
const displayName = (name) => (name && name.replace(/[\u0300-\u036f]/g, ''));
const atName = (user) => {
	if (CONVERT_USER_NAME) {
		return user && CHAT_ACCOUNTS[user.username] ? '@' + CHAT_ACCOUNTS[user.username] : '';
	}
	return user && user.name ? '@' + displayName(user.name) : '';
};
const makeAttachment = (author, text, timestamp, color) => {
	const currentTime = (new Date()).toISOString();
	const attachment = {
		author_name: author ? displayName(author.name) : '',
		author_icon: author ? author.avatar_url : '',
		ts: timestamp || currentTime,
		text,
		color: color || NOTIF_COLOR
	};
	if (ATTACHMENT_TITLE_SIZE > 0) {
		attachment.title = text.substring(0, ATTACHMENT_TITLE_SIZE) + '...';
	}

	return attachment;
};
const pushUniq = (array, val) => ~array.indexOf(val) || array.push(val); // eslint-disable-line

class Script { // eslint-disable-line
	process_incoming_request({ request }) {
		try {
			let result = null;
			const channel = request.url.query.channel;
			const event = request.headers['x-gitlab-event'];
			switch (event) {
				case 'Push Hook':
					result = this.pushEvent(request.content);
					break;
				case 'Merge Request Hook':
					result = this.mergeRequestEvent(request.content);
					break;
				case 'Note Hook':
					result = this.commentEvent(request.content);
					break;
				case 'Confidential Issue Hook':
				case 'Issue Hook':
					result = this.issueEvent(request.content, event);
					break;
				case 'Tag Push Hook':
					result = this.tagEvent(request.content);
					break;
				case 'Pipeline Hook':
				case 'Pipeline Event':
					result = this.pipelineEvent(request.content);
					break;
				case 'Build Hook': // GitLab < 9.3.0
				case 'Job Hook': // GitLab >= 9.3.0
					result = this.buildEvent(request.content);
					break;
				case 'Wiki Page Hook':
					result = this.wikiEvent(request.content);
					break;
				case 'System Hook':
					result = this.systemEvent(request.content);
					break;
				default:
					if (IGNORE_UNKNOWN_EVENTS) {
						console.log('gitlabevent unknown', event);
						return { error: { success: false, message: `unknonwn event ${event}` } };
					}
					result = IGNORE_UNKNOWN_EVENTS ? null : this.unknownEvent(request, event);
					break;
			}
			if (result && result.content && channel) {
				result.content.channel = '#' + channel;
			}
			return result;
		} catch (e) {
			console.log('gitlabevent error', e);
			return this.createErrorChatMessage(e);
		}
	}

	createErrorChatMessage(error) {
		if (IGNORE_ERROR_MESSAGES) {
			return { error: { success: false, message: `gitlabevent error: ${error.message}` } };
		}
		return {
			content: {
				username: 'Rocket.Cat ErrorHandler',
				text: 'Webhookリクエストを整形中にエラーが起きました。詳細は以下',
				icon_url: USE_ROCKETCHAT_AVATAR ? null : DEFAULT_AVATAR,
				attachments: [
					{
						text: `Error: '${error}', \n Message: '${error.message}', \n Stack: '${error.stack}'`,
						color: NOTIF_COLOR
					}
				]
			}
		};
	}

	unknownEvent(data, event) {
		const user_avatar = data.user ? data.user.avatar_url : (data.user_avatar || DEFAULT_AVATAR);
		return {
			content: {
				username: data.user ? data.user.name : (data.user_name || 'Unknown user'),
				text: `判別できないイベント '${event}' のWebhookリクエストがありました。詳細は以下`,
				icon_url: USE_ROCKETCHAT_AVATAR ? null : user_avatar,
				attachments: [
					{
						text: `${JSON.stringify(data, null, 4)}`,
						color: NOTIF_COLOR
					}
				]
			}
		};
	}
	issueEvent(data, event) {
		if (event === 'Confidential Issue Hook' && IGNORE_CONFIDENTIAL) {
			return false;
		}
		const project = data.project || data.repository;
		const action = data.object_attributes.action;
		const time = data.object_attributes.updated_at;
		const project_avatar = project.avatar_url || data.user.avatar_url || DEFAULT_AVATAR;
		
		if (NOTIF_ISSUE_ACTION[action] === false) {
			return false;
		}

		return {
			content: {
				username: 'gitlab/' + project.name,
				icon_url: USE_ROCKETCHAT_AVATAR ? null : project_avatar,
				text: (data.assignees && data.assignees[0].username !== data.user.username) ? atName(data.assignees[0]) : '',
				attachments: [
					makeAttachment(
						data.user,
						`issue [${data.object_attributes.title}](${data.object_attributes.url}) が${ACTION_VERBS[action]}されました。\n
						${data.object_attributes.description}`,
						time
					)
				]
			}
		};
	}

	commentEvent(data) {
		const project = data.project || data.repository;
		const comment = data.object_attributes;
		const user = data.user;
		const avatar = project.avatar_url || user.avatar_url || DEFAULT_AVATAR;
		const at = [];
		let text;
		if (data.merge_request) {
			const mr = data.merge_request;
			const lastCommitAuthor = mr.last_commit && mr.last_commit.author;
			if (mr.assignee && mr.assignee.name !== user.name) {
				at.push(atName(mr.assignee));
			}
			if (lastCommitAuthor && lastCommitAuthor.name !== user.name) {
				pushUniq(at, atName(lastCommitAuthor));
			}
			text = `マージリクエスト [#${mr.id} ${mr.title}](${comment.url}) にコメントがありました。`;
		} else if (data.commit) {
			const commit = data.commit;
			const message = commit.message.replace(/\n[^\s\S]+/, '...').replace(/\n$/, '');
			if (commit.author && commit.author.name !== user.name) {
				at.push(atName(commit.author));
			}
			text = `コミット [${commit.id.slice(0, 8)} ${message}](${comment.url}) にコメントがありました。`;
		} else if (data.issue) {
			const issue = data.issue;
			text = `issue [#${issue.id} ${issue.title}](${comment.url}) にコメントがありました。`;
		} else if (data.snippet) {
			const snippet = data.snippet;
			text = `コードスニペット [#${snippet.id} ${snippet.title}](${comment.url}) にコメントがありました。`;
		}
		return {
			content: {
				username: 'gitlab/' + project.name,
				icon_url: USE_ROCKETCHAT_AVATAR ? null : avatar,
				text: at.join(' '),
				attachments: [
					makeAttachment(user, `${text}\n${comment.note}`, comment.updated_at)
				]
			}
		};
	}

	mergeRequestEvent(data) {
		const user = data.user;
		const mr = data.object_attributes;
		const assignee = data.assignees ? data.assignees[0] : null;
		const avatar = mr.target.avatar_url || mr.source.avatar_url || user.avatar_url || DEFAULT_AVATAR;
		let at = []; // eslint-disable-line

		if (NOTIF_MR_ACTION[mr.action] === false) {
			return false;
		}

		if (mr.action === 'open' && assignee) {
			at.push(atName(assignee));
		} else if (mr.action === 'merge') {
			const lastCommitAuthor = mr.last_commit && mr.last_commit.author;
			if (assignee && assignee.username !== user.username) {
				at.push(atName(assignee));
			}
			if (lastCommitAuthor && lastCommitAuthor.username !== user.username) {
				pushUniq(at, atName(lastCommitAuthor));
			}
		} else if (mr.action === 'update' && assignee) {
			at.push(atName(assignee));
		}
		return {
			content: {
				username: `gitlab/${mr.target.name}`,
				icon_url: USE_ROCKETCHAT_AVATAR ? null : avatar,
				text: at.join(' '),
				attachments: [
					makeAttachment(
						user,
						`マージリクエスト [!${mr.iid}：${mr.title}](${mr.url})（${mr.source_branch} → ${mr.target_branch}）が${ACTION_VERBS[mr.action]}されました。`,
						mr.updated_at)
				]
			}
		};
	}

	pushEvent(data) {
		const project = data.project || data.repository;
		const web_url = project.web_url || project.homepage;
		const user = {
			name: data.user_name,
			avatar_url: data.user_avatar
		};
		const avatar = project.avatar_url || data.user_avatar || DEFAULT_AVATAR;
		// branch removal
		if (data.checkout_sha === null && !data.commits.length) {
			return {
				content: {
					username: `gitlab/${project.name}`,
					icon_url: USE_ROCKETCHAT_AVATAR ? null : avatar,
					attachments: [
						makeAttachment(user, `[${project.name}](${web_url})からブランチ ${refParser(data.ref)} が削除されました。`)
					]
				}
			};
		}
		// new branch
		if (data.before == 0) { // eslint-disable-line
			return {
				content: {
					username: `gitlab/${project.name}`,
					icon_url: USE_ROCKETCHAT_AVATAR ? null : avatar,
					attachments: [
						makeAttachment(
							user,
							`[${project.name}](${web_url})に新しいブランチ [${refParser(data.ref)}](${web_url}/commits/${refParser(data.ref)}) が作成されました。\n
							このコミットは、masterから${data.total_commits_count}コミット進んでいます。`
						)
					]
				}
			};
		}
		return {
			content: {
				username: `gitlab/${project.name}`,
				icon_url: USE_ROCKETCHAT_AVATAR ? null : avatar,
				attachments: [
					makeAttachment(user, `[${project.name}](${web_url})のブランチ [${refParser(data.ref)}](${web_url}/commits/${refParser(data.ref)}) に${data.total_commits_count}コミットpushされました。`),
					{
						text: data.commits.map((commit) => `  - ${new Date(commit.timestamp).toUTCString()} [${commit.id.slice(0, 8)}](${commit.url}) by ${commit.author.name}: ${commit.message.replace(/\s*$/, '')}`).join('\n'),
						color: NOTIF_COLOR
					}
				]
			}
		};
	}

	tagEvent(data) {
		const project = data.project || data.repository;
		const web_url = project.web_url || project.homepage;
		const tag = refParser(data.ref);
		const user = {
			name: data.user_name,
			avatar_url: data.user_avatar
		};
		const avatar = project.avatar_url || data.user_avatar || DEFAULT_AVATAR;
		let message;
		if (data.checkout_sha === null) {
			message = `タグ [${tag}](${web_url}/tags/) が削除されました。`;
		} else {
			message = `タグ [${tag} ${data.checkout_sha.slice(0, 8)}](${web_url}/tags/${tag}) が付与されました。`;
		}
		return {
			content: {
				username: `gitlab/${project.name}`,
				icon_url: USE_ROCKETCHAT_AVATAR ? null : avatar,
				text: MENTION_ALL_ALLOWED ? '@all' : '',
				attachments: [
					makeAttachment(user, message)
				]
			}
		};
	}

	pipelineEvent(data) {
		const project = data.project || data.repository;
		const commit = data.commit;
		const user = {
			name: data.user_name,
			avatar_url: data.user_avatar
		};
		const pipeline = data.object_attributes;
		const pipeline_time = pipeline.finished_at || pipeline.created_at;
		const avatar = project.avatar_url || data.user_avatar || DEFAULT_AVATAR;

		if (NOTIF_PIPELINE_STATUSES[pipeline.status] === false) {
			return false;
		}
		return {
			content: {
				username: `gitlab/${project.name}`,
				icon_url: USE_ROCKETCHAT_AVATAR ? null : avatar,
				attachments: [
					makeAttachment(
						user,
						`パイプライン *${pipeline.status}*\n対象コミット: [${commit.id.slice(0, 8)}](${commit.url})（by ${commit.author.name}）`,
						pipeline_time,
						STATUSES_COLORS[pipeline.status]
					)
				]
			}
		};
	}

	buildEvent(data) {
		const user = {
			name: data.user_name,
			avatar_url: data.user_avatar
		};

		return {
			content: {
				username: `gitlab/${data.repository.name}`,
				icon_url: USE_ROCKETCHAT_AVATAR ? null : DEFAULT_AVATAR,
				attachments: [
					makeAttachment(
						user,
						`ビルド ${data.build_name}（[${data.project_name}](${data.repository.homepage})） *${data.build_status}*`,
						null,
						STATUSES_COLORS[data.build_status]
					)
				]
			}
		};
	}

	wikiPageTitle(wiki_page) {
		if (wiki_page.action === 'delete') {
			return wiki_page.title;
		}

		return `[${wiki_page.title}](${wiki_page.url})`;
	}

	wikiEvent(data) {
		const user_name = data.user.name;
		const project = data.project;
		const project_path = project.path_with_namespace;
		const wiki_page = data.object_attributes;
		const wiki_page_title = this.wikiPageTitle(wiki_page);
		const user_action = ACTION_VERBS[wiki_page.action] || 'modified';
		const avatar = project.avatar_url || data.user.avatar_url || DEFAULT_AVATAR;

		return {
			content: {
				username: project_path,
				icon_url: USE_ROCKETCHAT_AVATAR ? null : avatar,
				text: `Wikiページ ${wiki_page_title} が${user_action}されました。（by ${user_name}）`
			}
		};
	}

	systemEvent(data) {
		const event_name = data.event_name;
		const [, eventType] = data.event_name.split('_');
		const action = eventType in ACTION_VERBS ? ACTION_VERBS[eventType] : '';
		let text = '';
		switch (event_name) {
			case 'project_create':
			case 'project_destroy':
			case 'project_update':
				text = `プロジェクト \`${data.path_with_namespace}\` が${action}されました。`;
				break;
			case 'project_rename':
			case 'project_transfer':
				text = `プロジェクト \`${data.old_path_with_namespace}\` が \`${data.path_with_namespace}\` に${action}しました。`;
				break;
			case 'user_add_to_team':
				text = `ユーザ \`${data.user_username}\`（権限：${data.project_access}）が、プロジェクト \`${data.project_path_with_namespace}\` に${action}されました。`;
				break;
			case 'user_remove_from_team':
				text = `ユーザ \`${data.user_username}\`（権限：${data.project_access}）が、プロジェクト \`${data.project_path_with_namespace}\` から${action}されました。`;
				break;
			case 'user_add_to_group':
				text = `ユーザ \`${data.user_username}\`（権限：${data.group_access}） が、グループ \`${data.group_path}\` に${action}されました。`;
				break;
			case 'user_remove_from_group':
				text = `ユーザ \`${data.user_username}\`（権限：${data.group_access}） が、グループ \`${data.group_path}\` から${action}されました。`;
				break;
			case 'user_create':
			case 'user_destroy':
				text = `ユーザ \`${data.username}\` が${action}されました。`;
				break;
			case 'user_rename':
				text = `ユーザ \`${data.old_username}\` が \`${data.username}\` に${action}されました。`;
				break;
			case 'key_create':
			case 'key_destroy':
				text = `\`${data.username}\` がキーを${action}しました。`;
				break;
			case 'group_create':
			case 'group_destroy':
				text = `グループ \`${data.path}\` が${action}されました。`;
				break;
			case 'group_rename':
				text = `グループ \`${data.old_full_path}\` が \`${data.full_path}\` に${action}されました。`;
				break;
			default:
				text = '判別できないシステムイベントがありました。';
				break;
		}

		return {
			content: {
				text: `${text}`,
				attachments: [
					{
						text: `${JSON.stringify(data, null, 4)}`,
						color: NOTIF_COLOR
					}
				]
			}
		};
	}
}
