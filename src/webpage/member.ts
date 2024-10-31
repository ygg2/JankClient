import{ User }from"./user.js";
import{ Role }from"./role.js";
import{ Guild }from"./guild.js";
import{ SnowFlake }from"./snowflake.js";
import{ memberjson, presencejson }from"./jsontypes.js";
import{ Dialog }from"./dialog.js";

class Member extends SnowFlake{
	static already = {};
	owner: Guild;
	user: User;
	roles: Role[] = [];
	nick!: string;

	private constructor(memberjson: memberjson, owner: Guild){
		super(memberjson.id);
		this.owner = owner;
		if(this.localuser.userMap.has(memberjson.id)){
			this.user = this.localuser.userMap.get(memberjson.id) as User;
		}else if(memberjson.user){
			this.user = new User(memberjson.user, owner.localuser);
		}else{
			throw new Error("Missing user object of this member");
		}
		if(this.localuser.userMap.has(this?.id)){
			this.user = this.localuser.userMap.get(this?.id) as User;
		}
		for(const key of Object.keys(memberjson)){
			if(key === "guild" || key === "owner" || key === "user"){
				continue;
			}

			if(key === "roles"){
				for(const strrole of memberjson.roles){
					const role = this.guild.roleids.get(strrole);
					if(!role)continue;
					this.roles.push(role);
				}
				continue;
			}
			if(key === "presence"){
				this.getPresence(memberjson.presence);
				continue;
			}
			(this as any)[key] = (memberjson as any)[key];
		}

		this.roles.sort((a, b)=>{
			return this.guild.roles.indexOf(a) - this.guild.roles.indexOf(b);
		});
	}
	update(memberjson: memberjson){
		this.roles=[];
		for(const key of Object.keys(memberjson)){
			if(key === "guild" || key === "owner" || key === "user"){
				continue;
			}

			if(key === "roles"){
				for(const strrole of memberjson.roles){
					const role = this.guild.roleids.get(strrole);
					if(!role)continue;
					this.roles.push(role);
				}
				continue;
			}
			if(key === "presence"){
				this.getPresence(memberjson.presence);
				continue;
			}
			(this as any)[key] = (memberjson as any)[key];
		}

		this.roles.sort((a, b)=>{
			return this.guild.roles.indexOf(a) - this.guild.roles.indexOf(b);
		});
	}
	get guild(){
		return this.owner;
	}
	get localuser(){
		return this.guild.localuser;
	}
	get info(){
		return this.owner.info;
	}
	static async new(
		memberjson: memberjson,
		owner: Guild
	): Promise<Member | undefined>{
		let user: User;
		if(owner.localuser.userMap.has(memberjson.id)){
			user = owner.localuser.userMap.get(memberjson.id) as User;
		}else if(memberjson.user){
			user = new User(memberjson.user, owner.localuser);
		}else{
			throw new Error("missing user object of this member");
		}
		if(user.members.has(owner)){
			let memb = user.members.get(owner);
			if(memb === undefined){
				memb = new Member(memberjson, owner);
				user.members.set(owner, memb);
				owner.members.add(memb);
				return memb;
			}else if(memb instanceof Promise){
				return await memb; //I should do something else, though for now this is "good enough"
			}else{
				if(memberjson.presence){
					memb.getPresence(memberjson.presence);
				}
				return memb;
			}
		}else{
			const memb = new Member(memberjson, owner);
			user.members.set(owner, memb);
			owner.members.add(memb);
			return memb;
		}
	}
	static async resolveMember(
		user: User,
		guild: Guild
	): Promise<Member | undefined>{
		const maybe = user.members.get(guild);
		if(!user.members.has(guild)){
			const membpromise = guild.localuser.resolvemember(user.id, guild.id);
			const promise = new Promise<Member | undefined>(async res=>{
				const membjson = await membpromise;
				if(membjson === undefined){
					return res(undefined);
				}else{
					const member = new Member(membjson, guild);
					const map = guild.localuser.presences;
					member.getPresence(map.get(member.id));
					map.delete(member.id);
					res(member);
					return member;
				}
			});
			user.members.set(guild, promise);
		}
		if(maybe instanceof Promise){
			return await maybe;
		}else{
			return maybe;
		}
	}
	public getPresence(presence: presencejson | undefined){
		this.user.getPresence(presence);
	}
	/**
				* @todo
				*/
	highInfo(){
		fetch(
			this.info.api +
				"/users/" +
				this.id +
				"/profile?with_mutual_guilds=true&with_mutual_friends_count=true&guild_id=" +
				this.guild.id,
			{ headers: this.guild.headers }
		);
	}
	hasRole(ID: string){
		console.log(this.roles, ID);
		for(const thing of this.roles){
			if(thing.id === ID){
				return true;
			}
		}
		return false;
	}
	getColor(){
		for(const thing of this.roles){
			const color = thing.getColor();
			if(color){
				return color;
			}
		}
		return"";
	}
	isAdmin(){
		for(const role of this.roles){
			if(role.permissions.getPermission("ADMINISTRATOR")){
				return true;
			}
		}
		return this.guild.properties.owner_id === this.user.id;
	}
	bind(html: HTMLElement){
		if(html.tagName === "SPAN"){
			if(!this){
				return;
			}
			/*
				if(this.error){

				}
				*/
			html.style.color = this.getColor();
		}

		//this.profileclick(html);
	}
	profileclick(/* html: HTMLElement */){
		//to be implemented
	}
	get name(){
		return this.nick || this.user.username;
	}
	kick(){
		let reason = "";
		const menu = new Dialog([
			"vdiv",
			["title", "Kick " + this.name + " from " + this.guild.properties.name],
			[
				"textbox",
				"Reason:",
				"",
				function(e: Event){
					reason = (e.target as HTMLInputElement).value;
				},
			],
			[
				"button",
				"",
				"submit",
				()=>{
					this.kickAPI(reason);
					menu.hide();
				},
			],
		]);
		menu.show();
	}
	kickAPI(reason: string){
		const headers = structuredClone(this.guild.headers);
		(headers as any)["x-audit-log-reason"] = reason;
		fetch(`${this.info.api}/guilds/${this.guild.id}/members/${this.id}`, {
			method: "DELETE",
			headers,
		});
	}
	ban(){
		let reason = "";
		const menu = new Dialog([
			"vdiv",
			["title", "Ban " + this.name + " from " + this.guild.properties.name],
			[
				"textbox",
				"Reason:",
				"",
				function(e: Event){
					reason = (e.target as HTMLInputElement).value;
				},
			],
			[
				"button",
				"",
				"submit",
				()=>{
					this.banAPI(reason);
					menu.hide();
				},
			],
		]);
		menu.show();
	}
	addRole(role:Role){
		const roles=this.roles.map(_=>_.id)
		roles.push(role.id);
		fetch(this.info.api+"/guilds/"+this.guild.id+"/members/"+this.id,{
			method:"PATCH",
			headers:this.guild.headers,
			body:JSON.stringify({roles})
		})
	}
	removeRole(role:Role){
		let roles=this.roles.map(_=>_.id)
		roles=roles.filter(_=>_!==role.id);
		fetch(this.info.api+"/guilds/"+this.guild.id+"/members/"+this.id,{
			method:"PATCH",
			headers:this.guild.headers,
			body:JSON.stringify({roles})
		})
	}
	banAPI(reason: string){
		const headers = structuredClone(this.guild.headers);
		(headers as any)["x-audit-log-reason"] = reason;
		fetch(`${this.info.api}/guilds/${this.guild.id}/bans/${this.id}`, {
			method: "PUT",
			headers,
		});
	}
	hasPermission(name: string): boolean{
		if(this.isAdmin()){
			return true;
		}
		for(const thing of this.roles){
			if(thing.permissions.getPermission(name)){
				return true;
			}
		}
		return false;
	}
}
export{ Member };
