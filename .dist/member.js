import { User } from "./user.js";
import { SnowFlake } from "./snowflake.js";
import { Dialog } from "./dialog.js";
class Member extends SnowFlake {
    static already = {};
    owner;
    user;
    roles = [];
    nick;
    constructor(memberjson, owner) {
        super(memberjson.id);
        this.owner = owner;
        if (this.localuser.userMap.has(memberjson.id)) {
            this.user = this.localuser.userMap.get(memberjson.id);
        }
        else if (memberjson.user) {
            this.user = new User(memberjson.user, owner.localuser);
        }
        else {
            throw new Error("Missing user object of this member");
        }
        for (const thing of Object.keys(memberjson)) {
            if (thing === "guild") {
                continue;
            }
            if (thing === "owner") {
                continue;
            }
            if (thing === "roles") {
                for (const strrole of memberjson.roles) {
                    const role = this.guild.roleids.get(strrole);
                    if (!role)
                        continue;
                    this.roles.push(role);
                }
                continue;
            }
            this[thing] = memberjson[thing];
        }
        if (this.localuser.userMap.has(this?.id)) {
            this.user = this.localuser.userMap.get(this?.id);
        }
        this.roles.sort((a, b) => { return (this.guild.roles.indexOf(a) - this.guild.roles.indexOf(b)); });
    }
    get guild() {
        return this.owner;
    }
    get localuser() {
        return this.guild.localuser;
    }
    get info() {
        return this.owner.info;
    }
    static async new(memberjson, owner) {
        let user;
        if (owner.localuser.userMap.has(memberjson.id)) {
            user = owner.localuser.userMap.get(memberjson.id);
        }
        else if (memberjson.user) {
            user = new User(memberjson.user, owner.localuser);
        }
        else {
            throw new Error("missing user object of this member");
        }
        if (user.members.has(owner)) {
            let memb = user.members.get(owner);
            if (memb === undefined) {
                memb = new Member(memberjson, owner);
                user.members.set(owner, memb);
                return memb;
            }
            else if (memb instanceof Promise) {
                return await memb; //I should do something else, though for now this is "good enough"
            }
            else {
                return memb;
            }
        }
        else {
            const memb = new Member(memberjson, owner);
            user.members.set(owner, memb);
            return memb;
        }
    }
    static async resolveMember(user, guild) {
        const maybe = user.members.get(guild);
        if (!user.members.has(guild)) {
            const membpromise = guild.localuser.resolvemember(user.id, guild.id);
            const promise = new Promise(async (res) => {
                const membjson = await membpromise;
                if (membjson === undefined) {
                    res(undefined);
                }
                else {
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
        if (maybe instanceof Promise) {
            return await maybe;
        }
        else {
            return maybe;
        }
    }
    getPresence(presence) {
        this.user.getPresence(presence);
    }
    /**
     * @todo
     */
    highInfo() {
        fetch(this.info.api + "/users/" + this.id + "/profile?with_mutual_guilds=true&with_mutual_friends_count=true&guild_id=" + this.guild.id, { headers: this.guild.headers });
    }
    hasRole(ID) {
        console.log(this.roles, ID);
        for (const thing of this.roles) {
            if (thing.id === ID) {
                return true;
            }
        }
        return false;
    }
    getColor() {
        for (const thing of this.roles) {
            const color = thing.getColor();
            if (color) {
                return color;
            }
        }
        return "";
    }
    isAdmin() {
        for (const role of this.roles) {
            if (role.permissions.getPermission("ADMINISTRATOR")) {
                return true;
            }
        }
        return this.guild.properties.owner_id === this.user.id;
    }
    bind(html) {
        if (html.tagName === "SPAN") {
            if (!this) {
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
    profileclick(html) {
        //to be implemented
    }
    get name() {
        return this.nick || this.user.username;
    }
    kick() {
        let reason = "";
        const menu = new Dialog(["vdiv",
            ["title", "Kick " + this.name + " from " + this.guild.properties.name],
            ["textbox", "Reason:", "", function (e) {
                    reason = e.target.value;
                }],
            ["button", "", "submit", () => {
                    this.kickAPI(reason);
                    menu.hide();
                }]]);
        menu.show();
    }
    kickAPI(reason) {
        const headers = structuredClone(this.guild.headers);
        headers["x-audit-log-reason"] = reason;
        fetch(`${this.info.api}/guilds/${this.guild.id}/members/${this.id}`, {
            method: "DELETE",
            headers,
        });
    }
    ban() {
        let reason = "";
        const menu = new Dialog(["vdiv",
            ["title", "Ban " + this.name + " from " + this.guild.properties.name],
            ["textbox", "Reason:", "", function (e) {
                    reason = e.target.value;
                }],
            ["button", "", "submit", () => {
                    this.banAPI(reason);
                    menu.hide();
                }]]);
        menu.show();
    }
    banAPI(reason) {
        const headers = structuredClone(this.guild.headers);
        headers["x-audit-log-reason"] = reason;
        fetch(`${this.info.api}/guilds/${this.guild.id}/bans/${this.id}`, {
            method: "PUT",
            headers
        });
    }
    hasPermission(name) {
        if (this.isAdmin()) {
            return true;
        }
        for (const thing of this.roles) {
            if (thing.permissions.getPermission(name)) {
                return true;
            }
        }
        return false;
    }
}
export { Member };
